SPOT_INSTRUMENTS = {
    "nifty": ("NSE", "NIFTY 50"),
    "banknifty": ("NSE", "NIFTY BANK"),
    "sensex": ("BSE", "SENSEX"),
}


def resolve_spot_tokens(master_contract):
    tokens = {}
    for key, (exchange, symbol) in SPOT_INSTRUMENTS.items():
        rows = master_contract[
            (master_contract["exchange"] == exchange)
            & (master_contract["segment"] == "INDICES")
            & (master_contract["tradingsymbol"] == symbol)
        ]
        tokens[key] = None if rows.empty else int(rows.iloc[0]["instrument_token"])
    return tokens
