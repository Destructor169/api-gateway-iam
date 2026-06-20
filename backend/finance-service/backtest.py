import pandas as pd
import numpy as np

def run_backtest(df, signal_col, stop_loss_pct=None, take_profit_pct=None, val_split_pct=20):
    """
    Simulates trades based on signals in df[signal_col].
    Assumes Long-Only for simplicity.
    """
    trades = []
    
    if df.empty or signal_col not in df.columns:
        return _calculate_metrics(trades)
        
    # Calculate split index for Train/Validation
    try:
        val_split = float(val_split_pct)
    except:
        val_split = 20.0
        
    split_idx = int(len(df) * (1 - (val_split / 100)))
    
    in_position = False
    entry_price = 0
    entry_date = None
    entry_idx = 0
    
    # Pre-extract to lists for speed
    closes = df['close'].values
    highs = df['high'].values
    lows = df['low'].values
    dates = df['date'].values
    signals = df[signal_col].values
    
    for i in range(len(df)):
        c, h, l, d, sig = closes[i], highs[i], lows[i], dates[i], signals[i]
        
        # Check exits if in position
        if in_position:
            exit_price = None
            exit_reason = None
            
            # 1. Check Stop Loss
            if stop_loss_pct is not None and stop_loss_pct > 0:
                sl_price = entry_price * (1 - (stop_loss_pct / 100))
                if l <= sl_price:
                    exit_price = sl_price
                    exit_reason = 'STOP_LOSS'
                    
            # 2. Check Take Profit
            if not exit_price and take_profit_pct is not None and take_profit_pct > 0:
                tp_price = entry_price * (1 + (take_profit_pct / 100))
                if h >= tp_price:
                    exit_price = tp_price
                    exit_reason = 'TAKE_PROFIT'
                    
            # 3. Check regular SELL signal
            if not exit_price and sig == 'SELL':
                exit_price = c
                exit_reason = 'SIGNAL'
                
            if exit_price is not None:
                pnl = exit_price - entry_price
                pnl_pct = (pnl / entry_price) * 100
                period = 'TRAIN' if entry_idx < split_idx else 'VAL'
                
                trades.append({
                    'entry_date': entry_date,
                    'exit_date': d,
                    'entry_price': round(entry_price, 4),
                    'exit_price': round(exit_price, 4),
                    'pnl': round(pnl, 4),
                    'pnl_pct': round(pnl_pct, 2),
                    'reason': exit_reason,
                    'period': period
                })
                in_position = False
                
        # Check entries if flat
        if not in_position and sig == 'BUY':
            in_position = True
            entry_price = c
            entry_date = d
            entry_idx = i

    # Close any open position at EOD
    if in_position:
        exit_price = closes[-1]
        pnl = exit_price - entry_price
        pnl_pct = (pnl / entry_price) * 100
        period = 'TRAIN' if entry_idx < split_idx else 'VAL'
        trades.append({
            'entry_date': entry_date,
            'exit_date': dates[-1],
            'entry_price': round(entry_price, 4),
            'exit_price': round(exit_price, 4),
            'pnl': round(pnl, 4),
            'pnl_pct': round(pnl_pct, 2),
            'reason': 'EOD_CLOSE',
            'period': period
        })
        
    return _calculate_metrics(trades)

def _calculate_metrics(trades):
    def calc(subset):
        if not subset:
            return {'trades': 0, 'win_rate': 0.0, 'pnl': 0.0, 'max_dd': 0.0}
        
        wins = sum(1 for t in subset if t['pnl'] > 0)
        win_rate = (wins / len(subset)) * 100
        total_pnl = sum(t['pnl_pct'] for t in subset)
        
        peak = 0
        max_dd = 0
        cum_pnl = 0
        for t in subset:
            cum_pnl += t['pnl_pct']
            if cum_pnl > peak:
                peak = cum_pnl
            dd = peak - cum_pnl
            if dd > max_dd:
                max_dd = dd
                
        return {
            'trades': len(subset),
            'win_rate': round(win_rate, 2),
            'pnl': round(total_pnl, 2),
            'max_dd': round(max_dd, 2)
        }
        
    train_trades = [t for t in trades if t['period'] == 'TRAIN']
    val_trades = [t for t in trades if t['period'] == 'VAL']
    
    return {
        'train': calc(train_trades),
        'val': calc(val_trades),
        'logs': trades
    }
