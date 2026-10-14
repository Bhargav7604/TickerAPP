import pytz
import threading
import datetime as dt
from colorama import init
from termcolor import cprint

init()

logger_lock = threading.Lock()


def log(message, level, log_in_file=True):
    global logger_lock

    with logger_lock:
        now = dt.datetime.now(tz=pytz.timezone("Asia/Kolkata"))

        if log_in_file:
            with open("./log.txt", "a") as log_file:
                log_file.write(f"{now.strftime('%c')}\t[{level.upper()}]\t{message}\n")

        if level.upper() == "INFO":
            color = "blue"

        elif level.upper() == "ERROR":
            color = "red"

        elif level.upper() == "SUCCESS":
            color = "green"

        elif level.upper() == "PLAIN":
            color = "white"

        cprint(f"[{level.upper()}]\t{message}", color)
