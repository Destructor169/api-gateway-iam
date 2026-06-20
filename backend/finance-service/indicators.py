import pandas as pd
import numpy as np

def apply_indicators(df, indicators_req):
    """
    indicators_req: list of dicts. e.g. [{"id": "ind_123", "type": "SMA", "period": 20}, ...]
    returns df with new columns.
    """
    signals = [] 
    overlays = [] 
    oscillators = [] 
    
    if df.empty:
        return df, {'overlays': overlays, 'oscillators': oscillators, 'signals': signals}
    
    for ind in indicators_req:
        itype = ind.get('type')
        iid = ind.get('id')
        if not iid: continue
        
        # --- TECHNICAL INDICATORS ---
        if itype == 'SMA':
            period = int(ind.get('period', 20))
            df[iid] = df['close'].rolling(window=period, min_periods=1).mean().round(4)
            overlays.append(iid)
            
        elif itype == 'EMA':
            period = int(ind.get('period', 20))
            df[iid] = df['close'].ewm(span=period, adjust=False).mean().round(4)
            overlays.append(iid)
            
        elif itype == 'MACD':
            fast = int(ind.get('fast', 12))
            slow = int(ind.get('slow', 26))
            sig = int(ind.get('signal', 9))
            ema_fast = df['close'].ewm(span=fast, adjust=False).mean()
            ema_slow = df['close'].ewm(span=slow, adjust=False).mean()
            df[iid] = (ema_fast - ema_slow).round(4)
            df[f'{iid}_signal'] = df[iid].ewm(span=sig, adjust=False).mean().round(4)
            df[f'{iid}_hist'] = (df[iid] - df[f'{iid}_signal']).round(4)
            oscillators.extend([iid, f'{iid}_signal', f'{iid}_hist'])
            
        elif itype == 'RSI':
            period = int(ind.get('period', 14))
            delta = df['close'].diff()
            gain = (delta.where(delta > 0, 0)).fillna(0)
            loss = (-delta.where(delta < 0, 0)).fillna(0)
            avg_gain = gain.rolling(window=period, min_periods=1).mean()
            avg_loss = loss.rolling(window=period, min_periods=1).mean()
            rs = avg_gain / avg_loss
            df[iid] = (100 - (100 / (1 + rs))).round(2)
            df[iid] = df[iid].fillna(50)
            oscillators.append(iid)
            
        elif itype == 'BBANDS':
            period = int(ind.get('period', 20))
            std_dev_mult = float(ind.get('stdDev', 2))
            sma = df['close'].rolling(window=period, min_periods=1).mean()
            std_dev = df['close'].rolling(window=period, min_periods=1).std()
            df[f'{iid}_upper'] = (sma + (std_dev_mult * std_dev)).round(4)
            df[f'{iid}_lower'] = (sma - (std_dev_mult * std_dev)).round(4)
            df[f'{iid}_mid'] = sma.round(4)
            overlays.extend([f'{iid}_upper', f'{iid}_lower', f'{iid}_mid'])

        elif itype == 'MEDIAN':
            period = int(ind.get('period', 20))
            df[iid] = df['close'].rolling(window=period, min_periods=1).median().round(4)
            overlays.append(iid)

        elif itype == 'ZSCORE':
            period = int(ind.get('period', 20))
            sma = df['close'].rolling(window=period, min_periods=1).mean()
            std_dev = df['close'].rolling(window=period, min_periods=1).std()
            df[iid] = ((df['close'] - sma) / std_dev).round(4)
            df[iid] = df[iid].fillna(0)
            oscillators.append(iid)

        # --- ALGORITHMIC STRATEGIES ---
        elif itype == 'STRAT_SMA_CROSS':
            fast_p = int(ind.get('fast', 20))
            slow_p = int(ind.get('slow', 50))
            fast_sma = df['close'].rolling(window=fast_p, min_periods=1).mean()
            slow_sma = df['close'].rolling(window=slow_p, min_periods=1).mean()
            diff = fast_sma - slow_sma
            prev_diff = diff.shift(1)
            
            signal_col = []
            for d, pdiff in zip(diff, prev_diff):
                if pd.isna(pdiff): signal_col.append(None)
                elif pdiff <= 0 and d > 0: signal_col.append('BUY')
                elif pdiff >= 0 and d < 0: signal_col.append('SELL')
                else: signal_col.append(None)
            df[iid] = signal_col
            signals.append(iid)

        elif itype == 'STRAT_EMA_CROSS':
            fast_p = int(ind.get('fast', 12))
            slow_p = int(ind.get('slow', 26))
            fast_ema = df['close'].ewm(span=fast_p, adjust=False).mean()
            slow_ema = df['close'].ewm(span=slow_p, adjust=False).mean()
            diff = fast_ema - slow_ema
            prev_diff = diff.shift(1)
            signal_col = []
            for d, pdiff in zip(diff, prev_diff):
                if pd.isna(pdiff): signal_col.append(None)
                elif pdiff <= 0 and d > 0: signal_col.append('BUY')
                elif pdiff >= 0 and d < 0: signal_col.append('SELL')
                else: signal_col.append(None)
            df[iid] = signal_col
            signals.append(iid)

        elif itype == 'STRAT_MACD':
            fast = int(ind.get('fast', 12))
            slow = int(ind.get('slow', 26))
            sig = int(ind.get('signal', 9))
            ema_fast = df['close'].ewm(span=fast, adjust=False).mean()
            ema_slow = df['close'].ewm(span=slow, adjust=False).mean()
            macd = ema_fast - ema_slow
            macd_signal = macd.ewm(span=sig, adjust=False).mean()
            diff = macd - macd_signal
            prev_diff = diff.shift(1)
            signal_col = []
            for d, pdiff in zip(diff, prev_diff):
                if pd.isna(pdiff): signal_col.append(None)
                elif pdiff <= 0 and d > 0: signal_col.append('BUY')
                elif pdiff >= 0 and d < 0: signal_col.append('SELL')
                else: signal_col.append(None)
            df[iid] = signal_col
            signals.append(iid)

        elif itype == 'STRAT_RSI_MOMENTUM':
            period = int(ind.get('period', 14))
            upper = float(ind.get('upper', 70))
            lower = float(ind.get('lower', 30))
            delta = df['close'].diff()
            gain = (delta.where(delta > 0, 0)).fillna(0)
            loss = (-delta.where(delta < 0, 0)).fillna(0)
            avg_gain = gain.rolling(window=period, min_periods=1).mean()
            avg_loss = loss.rolling(window=period, min_periods=1).mean()
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))
            prev_rsi = rsi.shift(1)
            signal_col = []
            for curr_r, prev_r in zip(rsi, prev_rsi):
                if pd.isna(prev_r): signal_col.append(None)
                elif prev_r <= lower and curr_r > lower: signal_col.append('BUY')
                elif prev_r >= upper and curr_r < upper: signal_col.append('SELL')
                else: signal_col.append(None)
            df[iid] = signal_col
            signals.append(iid)

        elif itype == 'STRAT_BB_REVERSAL':
            period = int(ind.get('period', 20))
            std_dev_mult = float(ind.get('stdDev', 2))
            sma = df['close'].rolling(window=period, min_periods=1).mean()
            std_dev = df['close'].rolling(window=period, min_periods=1).std()
            upper_bb = sma + (std_dev_mult * std_dev)
            lower_bb = sma - (std_dev_mult * std_dev)
            prev_close = df['close'].shift(1)
            prev_lower = lower_bb.shift(1)
            prev_upper = upper_bb.shift(1)
            signal_col = []
            for c, pc, l, pl, u, pu in zip(df['close'], prev_close, lower_bb, prev_lower, upper_bb, prev_upper):
                if pd.isna(pc): signal_col.append(None)
                elif pc <= pl and c > l: signal_col.append('BUY')
                elif pc >= pu and c < u: signal_col.append('SELL')
                else: signal_col.append(None)
            df[iid] = signal_col
            signals.append(iid)

        elif itype == 'STRAT_SUPPORT_RESISTANCE':
            period = int(ind.get('period', 20))
            rolling_high = df['high'].rolling(window=period).max().shift(1)
            rolling_low = df['low'].rolling(window=period).min().shift(1)
            signal_col = []
            for c, rh, rl in zip(df['close'], rolling_high, rolling_low):
                if pd.isna(rh): signal_col.append(None)
                elif c > rh: signal_col.append('BUY')
                elif c < rl: signal_col.append('SELL')
                else: signal_col.append(None)
            df[iid] = signal_col
            signals.append(iid)

        elif itype == 'STRAT_VOLUME_SPIKE':
            period = int(ind.get('period', 20))
            mult = float(ind.get('multiplier', 3.0))
            avg_vol = df['volume'].rolling(window=period).mean().shift(1)
            prev_close = df['close'].shift(1)
            signal_col = []
            for c, pc, v, av in zip(df['close'], prev_close, df['volume'], avg_vol):
                if pd.isna(av) or av == 0: signal_col.append(None)
                elif v > (av * mult):
                    if c > pc: signal_col.append('BUY')
                    else: signal_col.append('SELL')
                else: signal_col.append(None)
            df[iid] = signal_col
            signals.append(iid)

        elif itype == 'STRAT_VWAP_REVERSAL':
            # Simplified Anchored VWAP (anchored to the data window)
            typ_price = (df['high'] + df['low'] + df['close']) / 3
            vwap = (typ_price * df['volume']).cumsum() / df['volume'].cumsum()
            diff = df['close'] - vwap
            std_dev = diff.std()
            signal_col = []
            for d in diff:
                if pd.isna(d): signal_col.append(None)
                elif d < -2 * std_dev: signal_col.append('BUY')
                elif d > 2 * std_dev: signal_col.append('SELL')
                else: signal_col.append(None)
            df[iid] = signal_col
            signals.append(iid)
            
        elif itype == 'STRAT_GRID':
            # A simple representation of grid lines
            num_grids = int(ind.get('grids', 5))
            mx = df['close'].max()
            mn = df['close'].min()
            step = (mx - mn) / (num_grids + 1)
            for g in range(1, num_grids + 1):
                df[f'{iid}_grid_{g}'] = round(mn + step * g, 4)
                overlays.append(f'{iid}_grid_{g}')

    return df, {'overlays': overlays, 'oscillators': oscillators, 'signals': signals}
