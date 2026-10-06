"""Windows DPAPI: OAuth refresh tokens remain bound to the signed-in user."""
import ctypes
from ctypes import wintypes
import os
from pathlib import Path

class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_byte))]

def _crypt(data: bytes, decrypt: bool) -> bytes:
    if os.name != 'nt':
        raise RuntimeError('Windows DPAPI is required for credential storage')
    buffer = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    outgoing = Blob()
    api = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    ok = api(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing))
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        ctypes.windll.kernel32.LocalFree(outgoing.data)

def save(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_bytes(_crypt(text.encode(), False))
    temp.replace(path)

def load(path: Path) -> str:
    return _crypt(path.read_bytes(), True).decode()

