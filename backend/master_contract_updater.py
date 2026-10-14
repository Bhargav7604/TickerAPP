import io
import traceback
import os
import tempfile
import pandas as pd
import requests as r
from .logger import log
from .market_contracts import clear_master_contract_cache, master_contract_path
from .instruments import resolve_spot_tokens
from .equity import stock_derivative_mask

INDEX_OPTION_NAMES = {"NIFTY", "BANKNIFTY", "SENSEX"}


def fetch_master_contract():
    log("Updating Master Contract !", "INFO")

    try:
        res = r.get("https://api.kite.trade/instruments", timeout=30)
        res.raise_for_status()

        json = res.text
        # print(json)

        data = pd.read_csv(io.StringIO(json))
        spot_tokens = resolve_spot_tokens(data)
        data["stock_derivative"] = stock_derivative_mask(data)
        data = data[
            (data["instrument_type"] == "FUT") |
            (
                data["name"].isin(INDEX_OPTION_NAMES) &
                data["instrument_type"].isin(["CE", "PE"])
            )
            | data["instrument_token"].isin([token for token in spot_tokens.values() if token is not None])
            | data["stock_derivative"]
        ]

        path = master_contract_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as temporary:
                temporary_path = temporary.name
                data.to_csv(temporary, index=False)
            os.replace(temporary_path, path)
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.unlink(temporary_path)
        clear_master_contract_cache()

        log("Successfully Updated Master Contract !", "SUCCESS")

    except Exception as e:
        log(f"Error {e} came while updating the master contract !", "ERROR")
        traceback.print_exc()
