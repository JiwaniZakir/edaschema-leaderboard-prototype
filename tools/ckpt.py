"""Read PyTorch Lightning .ckpt files with the standard library only.

A .ckpt is a zip holding a pickle (archive/data.pkl) plus raw storage blobs
(archive/data/<key>). The pickle references those blobs through persistent ids,
so we stub out every torch class it names and resolve the tensors ourselves.
"""
import io, pickle, struct, zipfile

DTYPES = {
    "FloatStorage": ("f", 4), "DoubleStorage": ("d", 8),
    "HalfStorage": ("e", 2), "LongStorage": ("q", 8),
    "IntStorage": ("i", 4), "BoolStorage": ("?", 1),
}


class Storage:
    def __init__(self, key, dtype):
        self.key, self.dtype = key, dtype


class Tensor:
    def __init__(self, storage, offset, size, stride):
        self.storage, self.offset, self.size, self.stride = storage, offset, size, stride
        self.values = None

    def numel(self):
        n = 1
        for d in self.size:
            n *= d
        return n

    def rows(self):
        """2-D view as a list of rows (or a single row for 1-D)."""
        if len(self.size) == 1:
            return [list(self.values)]
        r, c = self.size
        return [list(self.values[i * c:(i + 1) * c]) for i in range(r)]


def _rebuild_tensor_v2(storage, offset, size, stride, *rest):
    return Tensor(storage, offset, tuple(size), tuple(stride))


class _Stub:
    """Stands in for any torch class the pickle happens to name."""
    def __init__(self, *a, **k):
        self.args, self.kwargs = a, k

    def __call__(self, *a, **k):
        return _Stub(*a, **k)

    def __setstate__(self, state):
        self.state = state


def _find_class(module, name):
    if name == "_rebuild_tensor_v2":
        return _rebuild_tensor_v2
    if name.endswith("Storage"):
        return type(name, (), {"__module__": module})
    if name == "OrderedDict":
        from collections import OrderedDict
        return OrderedDict
    if module.startswith("torch") or module.startswith("pytorch_lightning") \
            or module.startswith("lightning") or module.startswith("eda_ml") \
            or module.startswith("numpy"):
        return _Stub
    try:
        return pickle.Unpickler.find_class(pickle.Unpickler(io.BytesIO(b"")), module, name)
    except Exception:
        return _Stub


def load(path):
    zf = zipfile.ZipFile(path)
    prefix = zf.namelist()[0].split("/")[0]

    class U(pickle.Unpickler):
        def find_class(self, module, name):
            return _find_class(module, name)

        def persistent_load(self, pid):
            # ("storage", StorageType, key, location, numel)
            _, stype, key, _loc, _numel = pid
            return Storage(key, getattr(stype, "__name__", str(stype)))

    obj = U(io.BytesIO(zf.read(f"{prefix}/data.pkl"))).load()

    def hydrate(o, seen=None):
        if seen is None:
            seen = set()
        if isinstance(o, Tensor):
            if o.values is None:
                fmt, width = DTYPES.get(o.storage.dtype, ("f", 4))
                raw = zf.read(f"{prefix}/data/{o.storage.key}")
                n = o.numel()
                start = o.offset * width
                o.values = list(struct.unpack("<" + fmt * n, raw[start:start + n * width]))
        elif isinstance(o, dict):
            for v in o.values():
                hydrate(v, seen)
        elif isinstance(o, (list, tuple)):
            for v in o:
                hydrate(v, seen)
        return o

    return hydrate(obj)


def state_dict(path):
    obj = load(path)
    sd = obj.get("state_dict", obj) if isinstance(obj, dict) else obj
    return {k: v for k, v in sd.items() if isinstance(v, Tensor)}
