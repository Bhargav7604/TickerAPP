SPOT_INSTRUMENTS = {
    "nifty": ("NSE", "NIFTY 50"),
    "banknifty": ("NSE", "NIFTY BANK"),
    "sensex": ("BSE", "SENSEX"),
}


# Option chains also cover FINNIFTY and MIDCPNIFTY; the live index feed and Home stay on the three above.
OPTION_SPOT_INSTRUMENTS = {
    **SPOT_INSTRUMENTS,
    "finnifty": ("NSE", "NIFTY FIN SERVICE"),
    "midcpnifty": ("NSE", "NIFTY MID SELECT"),
}


def resolve_spot_tokens(master_contract, instruments=SPOT_INSTRUMENTS):
    tokens = {}
    for key, (exchange, symbol) in instruments.items():
        rows = master_contract[
            (master_contract["exchange"] == exchange)
            & (master_contract["segment"] == "INDICES")
            & (master_contract["tradingsymbol"] == symbol)
        ]
        tokens[key] = None if rows.empty else int(rows.iloc[0]["instrument_token"])
    return tokens
