"""Read scalar summaries out of TensorBoard event files with the stdlib only.

TFRecord frame: u64 length, u32 crc(length), payload, u32 crc(payload).
The payload is an Event protobuf; we walk just enough of the wire format to
reach Event.step (2), Event.wall_time (1) and Event.summary (5) -> value (1)
-> tag (1) / simple_value (2).
"""
import struct


def _varint(buf, i):
    shift = val = 0
    while True:
        b = buf[i]
        i += 1
        val |= (b & 0x7F) << shift
        if not b & 0x80:
            return val, i
        shift += 7


def _fields(buf):
    """Yield (field_number, wire_type, value) where value is bytes or a number."""
    i, n = 0, len(buf)
    while i < n:
        key, i = _varint(buf, i)
        fn, wt = key >> 3, key & 7
        if wt == 0:
            v, i = _varint(buf, i)
        elif wt == 1:
            v = struct.unpack_from("<d", buf, i)[0]
            i += 8
        elif wt == 2:
            ln, i = _varint(buf, i)
            v = buf[i:i + ln]
            i += ln
        elif wt == 5:
            v = struct.unpack_from("<f", buf, i)[0]
            i += 4
        else:
            return
        yield fn, wt, v


def records(path):
    with open(path, "rb") as fh:
        blob = fh.read()
    i, n = 0, len(blob)
    while i + 12 <= n:
        (ln,) = struct.unpack_from("<Q", blob, i)
        start = i + 12
        end = start + ln
        if end + 4 > n:
            return
        yield blob[start:end]
        i = end + 4


def scalars(path):
    """[(tag, step, wall_time, value)] in file order."""
    out = []
    for rec in records(path):
        step = 0
        wall = 0.0
        summaries = []
        for fn, wt, v in _fields(rec):
            if fn == 1 and wt == 1:
                wall = v
            elif fn == 2 and wt == 0:
                step = v
            elif fn == 5 and wt == 2:
                summaries.append(v)
        for s in summaries:
            for fn, wt, v in _fields(s):
                if fn != 1 or wt != 2:
                    continue
                tag, val = None, None
                for f2, w2, v2 in _fields(v):
                    if f2 == 1 and w2 == 2:
                        tag = v2.decode("utf-8", "replace")
                    elif f2 == 2 and w2 == 5:
                        val = v2
                if tag is not None and val is not None:
                    out.append((tag, step, wall, val))
    return out
