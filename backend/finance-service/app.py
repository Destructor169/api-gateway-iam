import os
import json
import traceback
import requests
import pandas as pd
import numpy as np
from datetime import datetime

from flask import Flask, request, jsonify
from flask_cors import CORS
import redis

import indicators
import backtest

app = Flask(__name__)
CORS(app)

REDIS_HOST = os.environ.get('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.environ.get('REDIS_PORT', 6379))

try:
    redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    redis_client.ping()
    print(f"Connected to Redis at {REDIS_HOST}:{REDIS_PORT}")
except Exception:
    redis_client = None
    print("Redis not available — running without cache")

def cache_get(key):
    if not redis_client: return None
    try:
        data = redis_client.get(key)
        return json.loads(data) if data else None
    except Exception: return None

def cache_set(key, value, ttl=60):
    if not redis_client: return
    try: redis_client.set(key, json.dumps(value), ex=ttl)
    except Exception: pass

HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}

def yf_request(url):
    res = requests.get(url, headers=HEADERS, timeout=10)
    res.raise_for_status()
    return res.json()

@app.route('/search')
def search():
    query = request.args.get('q', '').strip().upper()
    if not query: return jsonify({'error': 'Query required'}), 400
    cached = cache_get(f'search_{query}')
    if cached: return jsonify(cached)

    try:
        data = yf_request(f"https://query2.finance.yahoo.com/v1/finance/search?q={query}")
        quotes = data.get('quotes', [])
        results = []
        for q in quotes:
            if 'symbol' in q:
                results.append({
                    'symbol': q['symbol'],
                    'name': q.get('shortname') or q.get('longname') or q['symbol'],
                    'type': q.get('quoteType', 'UNKNOWN'),
                    'exchange': q.get('exchDisp', 'UNKNOWN'),
                    'currency': 'USD'
                })
        
        if not results:
            results.append({
                'symbol': query, 'name': f"{query} (Mock)", 'type': 'EQUITY', 'exchange': 'MOCK', 'currency': 'USD'
            })
            
        result = {'results': results}
        cache_set(f'search_{query}', result, 300)
        return jsonify(result)
    except Exception as e:
        print(f"Search error for '{query}': {e}")
        return jsonify({'results': [{'symbol': query, 'name': f"{query} (Mock)", 'type': 'EQUITY', 'exchange': 'MOCK', 'currency': 'USD'}]})

@app.route('/quote/<symbol>')
def quote(symbol):
    symbol = symbol.upper()
    cached = cache_get(f'quote_{symbol}')
    if cached: return jsonify(cached)

    try:
        data = yf_request(f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d")
        meta = data['chart']['result'][0]['meta']
        price = meta['regularMarketPrice']
        prev_close = meta['chartPreviousClose']
        change = round(price - prev_close, 4)
        change_pct = round((change / prev_close) * 100, 2)
        
        result = {
            'symbol': meta['symbol'],
            'name': meta.get('shortName', symbol),
            'price': price,
            'change': change,
            'changePercent': change_pct,
            'currency': meta.get('currency', 'USD'),
            'marketState': meta.get('regularMarketTime', 'UNKNOWN'),
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }
        cache_set(f'quote_{symbol}', result, 30)
        return jsonify(result)
    except Exception as e:
        print(f"Quote error for '{symbol}': {e}")
        import random
        base_price = round(random.uniform(100, 500), 2)
        return jsonify({
            'symbol': symbol, 'name': f"{symbol} (Mock Data)", 'price': base_price,
            'change': round(random.uniform(-5, 5), 2), 'changePercent': round(random.uniform(-2, 2), 2),
            'currency': 'USD', 'marketState': 'REGULAR', 'timestamp': datetime.utcnow().isoformat() + 'Z'
        })

@app.route('/history/<symbol>')
def history(symbol):
    symbol = symbol.upper()
    period = request.args.get('period', '1y')
    interval = request.args.get('interval', '1d')
    inds_json = request.args.get('indicators', '[]')
    backtest_json = request.args.get('backtest', '{}')
    
    try:
        inds_req = json.loads(inds_json)
    except:
        inds_req = []
        
    try:
        bt_config = json.loads(backtest_json)
    except:
        bt_config = {}

    # Switch to intraday if needed by strategy
    needs_intraday = any(ind.get('type') in ['STRAT_ORB', 'STRAT_VWAP_REVERSAL'] for ind in inds_req)
    if needs_intraday and interval == '1d':
        interval = '15m'
        if period in ['1y', '5y', 'max']:
            period = '60d' # Yahoo finance limits 15m to 60 days

    import hashlib
    inds_str = json.dumps(sorted(inds_req, key=lambda x: str(x)))
    bt_str = json.dumps(bt_config)
    inds_hash = hashlib.md5((inds_str + bt_str).encode()).hexdigest()
    
    cache_key = f'history_{symbol}_{period}_{interval}_{inds_hash}'
    cached = cache_get(cache_key)
    if cached: return jsonify(cached)

    range_val = period
    if period == 'max': range_val = 'max'

    try:
        data = yf_request(f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?interval={interval}&range={range_val}")
        res = data['chart']['result'][0]
        timestamps = res.get('timestamp', [])
        quotes = res['indicators']['quote'][0]
        
        data_points = []
        for i, ts in enumerate(timestamps):
            if quotes['close'][i] is not None:
                data_points.append({
                    'date': datetime.utcfromtimestamp(ts).strftime('%Y-%m-%dT%H:%M:%SZ'),
                    'open': round(quotes['open'][i], 4),
                    'high': round(quotes['high'][i], 4),
                    'low': round(quotes['low'][i], 4),
                    'close': round(quotes['close'][i], 4),
                    'volume': int(quotes['volume'][i] or 0)
                })
                
        if data_points:
            df = pd.DataFrame(data_points)
            df, meta = indicators.apply_indicators(df, inds_req)
            
            # Run backtests
            bt_results = {}
            sl = bt_config.get('stop_loss')
            tp = bt_config.get('take_profit')
            vs = bt_config.get('val_split', 20)
            
            for sig_col in meta.get('signals', []):
                bt_results[sig_col] = backtest.run_backtest(df, sig_col, sl, tp, vs)
            meta['backtest_results'] = bt_results
            
            df = df.replace({np.nan: None})
            data_points = df.to_dict('records')
        else:
            meta = {'overlays': [], 'oscillators': [], 'signals': [], 'backtest_results': {}}

        result = {
            'symbol': symbol, 'period': period, 'interval': interval,
            'data_points': len(data_points), 'data': data_points,
            'meta': meta
        }
        cache_set(cache_key, result, 60)
        return jsonify(result)
    except Exception as e:
        print(f"History error for '{symbol}': {e}")
        import random
        from datetime import timedelta
        mock_data = []
        base_price = 150.0
        for i in range(30):
            date_str = (datetime.utcnow() - timedelta(days=30-i)).strftime('%Y-%m-%dT%H:%M:%SZ')
            close_p = base_price + random.uniform(-2, 2)
            mock_data.append({
                'date': date_str, 'open': round(base_price, 4), 'high': round(max(base_price, close_p) + 1, 4),
                'low': round(min(base_price, close_p) - 1, 4), 'close': round(close_p, 4), 'volume': 100000
            })
            base_price = close_p
        return jsonify({'symbol': symbol, 'period': period, 'interval': interval, 'data_points': 30, 'data': mock_data, 'mocked': True})

TRENDING_SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'AAPL', 'TSLA', 'MSFT', 'GOOGL', 'AMZN', '^GSPC', '^DJI']

@app.route('/trending')
def trending():
    cached = cache_get('trending')
    if cached: return jsonify(cached)

    data = []
    try:
        symbols_str = ",".join(TRENDING_SYMBOLS)
        spark_data = yf_request(f"https://query2.finance.yahoo.com/v7/finance/spark?symbols={symbols_str}")
        for sym in TRENDING_SYMBOLS:
            res = spark_data['spark']['result']
            item = next((r for r in res if r['symbol'] == sym), None)
            if item and 'response' in item and len(item['response']) > 0:
                meta = item['response'][0]['meta']
                price = meta['regularMarketPrice']
                prev_close = meta['chartPreviousClose']
                change = round(price - prev_close, 4)
                change_pct = round((change / prev_close) * 100, 2)
                data.append({
                    'symbol': meta['symbol'],
                    'name': meta.get('shortName', sym),
                    'price': price,
                    'change': change,
                    'changePercent': change_pct,
                    'currency': meta.get('currency', 'USD')
                })
    except Exception as e:
        print(f"Trending error: {e}")
        pass

    result = {'timestamp': datetime.utcnow().isoformat() + 'Z', 'data': data}
    cache_set('trending', result, 60)
    return jsonify(result)

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'redis': 'connected' if redis_client else 'disconnected'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3002))
    app.run(host='0.0.0.0', port=port, debug=True)
