"""Starting constituent lists for the Index Stocks screen.

NIFTY 50 and NIFTY BANK come from NSE (refreshed daily by sync_index_constituents). BSE does not publish
SENSEX in a machine-readable form, so its list is kept here and in admin (Index constituents); check it
against bseindia.com after each June/December rebalance.
"""

AS_OF = "2026-11-02"

NSE_LISTS = {
    "nifty": "https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv",
    "banknifty": "https://nsearchives.nseindia.com/content/indices/ind_niftybanklist.csv",
}

SHORT_SECTORS = {
    "Information Technology": "IT",
    "Fast Moving Consumer Goods": "FMCG",
    "Oil Gas & Consumable Fuels": "Oil & Gas",
    "Automobile and Auto Components": "Auto",
    "Telecommunication": "Telecom",
}
PSU_BANKS = {"BANKBARODA", "CANBK", "PNB", "SBIN", "UNIONBANK", "BANKINDIA", "INDIANB"}


def sector_for(index_key, symbol, industry):
    """Bank Nifty is all one NSE industry, so split it into PSU and private banks to make sector flow useful."""
    if index_key == "banknifty":
        return "PSU Banks" if symbol in PSU_BANKS else "Private Banks"
    return SHORT_SECTORS.get(industry, industry)


# (symbol, company, NSE industry)
NIFTY = [
    ('ADANIENT', 'Adani Enterprises Ltd.', 'Metals & Mining'),
    ('ADANIPORTS', 'Adani Ports and Special Economic Zone Ltd.', 'Services'),
    ('APOLLOHOSP', 'Apollo Hospitals Enterprise Ltd.', 'Healthcare'),
    ('ASIANPAINT', 'Asian Paints Ltd.', 'Consumer Durables'),
    ('AXISBANK', 'Axis Bank Ltd.', 'Financial Services'),
    ('BSE', 'BSE Ltd.', 'Financial Services'),
    ('BAJAJ-AUTO', 'Bajaj Auto Ltd.', 'Automobile and Auto Components'),
    ('BAJFINANCE', 'Bajaj Finance Ltd.', 'Financial Services'),
    ('BAJAJFINSV', 'Bajaj Finserv Ltd.', 'Financial Services'),
    ('BEL', 'Bharat Electronics Ltd.', 'Capital Goods'),
    ('BHARTIARTL', 'Bharti Airtel Ltd.', 'Telecommunication'),
    ('CIPLA', 'Cipla Ltd.', 'Healthcare'),
    ('COALINDIA', 'Coal India Ltd.', 'Oil Gas & Consumable Fuels'),
    ('DRREDDY', "Dr. Reddy's Laboratories Ltd.", 'Healthcare'),
    ('EICHERMOT', 'Eicher Motors Ltd.', 'Automobile and Auto Components'),
    ('ETERNAL', 'Eternal Ltd.', 'Consumer Services'),
    ('GRASIM', 'Grasim Industries Ltd.', 'Construction Materials'),
    ('HCLTECH', 'HCL Technologies Ltd.', 'Information Technology'),
    ('HDFCBANK', 'HDFC Bank Ltd.', 'Financial Services'),
    ('HDFCLIFE', 'HDFC Life Insurance Company Ltd.', 'Financial Services'),
    ('HINDALCO', 'Hindalco Industries Ltd.', 'Metals & Mining'),
    ('HINDUNILVR', 'Hindustan Unilever Ltd.', 'Fast Moving Consumer Goods'),
    ('ICICIBANK', 'ICICI Bank Ltd.', 'Financial Services'),
    ('ITC', 'ITC Ltd.', 'Fast Moving Consumer Goods'),
    ('INFY', 'Infosys Ltd.', 'Information Technology'),
    ('INDIGO', 'InterGlobe Aviation Ltd.', 'Services'),
    ('JSWSTEEL', 'JSW Steel Ltd.', 'Metals & Mining'),
    ('JIOFIN', 'Jio Financial Services Ltd.', 'Financial Services'),
    ('KOTAKBANK', 'Kotak Mahindra Bank Ltd.', 'Financial Services'),
    ('LT', 'Larsen & Toubro Ltd.', 'Construction'),
    ('M&M', 'Mahindra & Mahindra Ltd.', 'Automobile and Auto Components'),
    ('MARUTI', 'Maruti Suzuki India Ltd.', 'Automobile and Auto Components'),
    ('MAXHEALTH', 'Max Healthcare Institute Ltd.', 'Healthcare'),
    ('NTPC', 'NTPC Ltd.', 'Power'),
    ('NESTLEIND', 'Nestle India Ltd.', 'Fast Moving Consumer Goods'),
    ('ONGC', 'Oil & Natural Gas Corporation Ltd.', 'Oil Gas & Consumable Fuels'),
    ('POWERGRID', 'Power Grid Corporation of India Ltd.', 'Power'),
    ('RELIANCE', 'Reliance Industries Ltd.', 'Oil Gas & Consumable Fuels'),
    ('SBILIFE', 'SBI Life Insurance Company Ltd.', 'Financial Services'),
    ('SHRIRAMFIN', 'Shriram Finance Ltd.', 'Financial Services'),
    ('SBIN', 'State Bank of India', 'Financial Services'),
    ('SUNPHARMA', 'Sun Pharmaceutical Industries Ltd.', 'Healthcare'),
    ('TCS', 'Tata Consultancy Services Ltd.', 'Information Technology'),
    ('TATACONSUM', 'Tata Consumer Products Ltd.', 'Fast Moving Consumer Goods'),
    ('TMPV', 'Tata Motors Passenger Vehicles Ltd.', 'Automobile and Auto Components'),
    ('TATASTEEL', 'Tata Steel Ltd.', 'Metals & Mining'),
    ('TECHM', 'Tech Mahindra Ltd.', 'Information Technology'),
    ('TITAN', 'Titan Company Ltd.', 'Consumer Durables'),
    ('TRENT', 'Trent Ltd.', 'Consumer Services'),
    ('ULTRACEMCO', 'UltraTech Cement Ltd.', 'Construction Materials'),
]
BANKNIFTY = [
    ('AUBANK', 'AU Small Finance Bank Ltd.', 'Financial Services'),
    ('AXISBANK', 'Axis Bank Ltd.', 'Financial Services'),
    ('BANKBARODA', 'Bank of Baroda', 'Financial Services'),
    ('CANBK', 'Canara Bank', 'Financial Services'),
    ('FEDERALBNK', 'Federal Bank Ltd.', 'Financial Services'),
    ('HDFCBANK', 'HDFC Bank Ltd.', 'Financial Services'),
    ('ICICIBANK', 'ICICI Bank Ltd.', 'Financial Services'),
    ('IDFCFIRSTB', 'IDFC First Bank Ltd.', 'Financial Services'),
    ('INDUSINDBK', 'IndusInd Bank Ltd.', 'Financial Services'),
    ('KOTAKBANK', 'Kotak Mahindra Bank Ltd.', 'Financial Services'),
    ('PNB', 'Punjab National Bank', 'Financial Services'),
    ('SBIN', 'State Bank of India', 'Financial Services'),
    ('UNIONBANK', 'Union Bank of India', 'Financial Services'),
    ('YESBANK', 'Yes Bank Ltd.', 'Financial Services'),
]
SENSEX = [
    ('ADANIPORTS', 'Adani Ports and Special Economic Zone Ltd.', 'Services'),
    ('ASIANPAINT', 'Asian Paints Ltd.', 'Consumer Durables'),
    ('AXISBANK', 'Axis Bank Ltd.', 'Financial Services'),
    ('BAJFINANCE', 'Bajaj Finance Ltd.', 'Financial Services'),
    ('BAJAJFINSV', 'Bajaj Finserv Ltd.', 'Financial Services'),
    ('BEL', 'Bharat Electronics Ltd.', 'Capital Goods'),
    ('BHARTIARTL', 'Bharti Airtel Ltd.', 'Telecommunication'),
    ('ETERNAL', 'Eternal Ltd.', 'Consumer Services'),
    ('HCLTECH', 'HCL Technologies Ltd.', 'Information Technology'),
    ('HDFCBANK', 'HDFC Bank Ltd.', 'Financial Services'),
    ('HINDUNILVR', 'Hindustan Unilever Ltd.', 'Fast Moving Consumer Goods'),
    ('ICICIBANK', 'ICICI Bank Ltd.', 'Financial Services'),
    ('INDIGO', 'InterGlobe Aviation Ltd.', 'Services'),
    ('INFY', 'Infosys Ltd.', 'Information Technology'),
    ('ITC', 'ITC Ltd.', 'Fast Moving Consumer Goods'),
    ('KOTAKBANK', 'Kotak Mahindra Bank Ltd.', 'Financial Services'),
    ('LT', 'Larsen & Toubro Ltd.', 'Construction'),
    ('M&M', 'Mahindra & Mahindra Ltd.', 'Automobile and Auto Components'),
    ('MARUTI', 'Maruti Suzuki India Ltd.', 'Automobile and Auto Components'),
    ('NTPC', 'NTPC Ltd.', 'Power'),
    ('POWERGRID', 'Power Grid Corporation of India Ltd.', 'Power'),
    ('RELIANCE', 'Reliance Industries Ltd.', 'Oil Gas & Consumable Fuels'),
    ('SBIN', 'State Bank of India', 'Financial Services'),
    ('SUNPHARMA', 'Sun Pharmaceutical Industries Ltd.', 'Healthcare'),
    ('TATASTEEL', 'Tata Steel Ltd.', 'Metals & Mining'),
    ('TCS', 'Tata Consultancy Services Ltd.', 'Information Technology'),
    ('TECHM', 'Tech Mahindra Ltd.', 'Information Technology'),
    ('TITAN', 'Titan Company Ltd.', 'Consumer Durables'),
    ('TRENT', 'Trent Ltd.', 'Consumer Services'),
    ('ULTRACEMCO', 'UltraTech Cement Ltd.', 'Construction Materials'),
]

SEED = {"nifty": NIFTY, "banknifty": BANKNIFTY, "sensex": SENSEX}

