"""Lưu các cấu hình có tên và cấu hình mặc định vào ~/.bg-remover/settings.json."""
import json
from pathlib import Path

DEFAULT_PATH = Path.home() / ".bg-remover" / "settings.json"


class Store:
    def __init__(self, path=DEFAULT_PATH):
        self.path = Path(path)
        self.profiles = {}
        self.default = None
        self.load()

    def load(self):
        profiles, default = {}, None
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(data.get("profiles"), dict):
                profiles = data["profiles"]
            default = data.get("default")
        except (OSError, ValueError, AttributeError):
            pass  # chưa có file hoặc file hỏng: bắt đầu với danh sách trống
        self.profiles = {str(k): v for k, v in profiles.items() if isinstance(v, dict)}
        self.default = default if default in self.profiles else None

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        payload = {"profiles": self.profiles, "default": self.default}
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    @property
    def names(self):
        return list(self.profiles)

    def put(self, name, values):
        self.profiles[name] = dict(values)
        self.save()

    def delete(self, name):
        self.profiles.pop(name, None)
        if self.default == name:
            self.default = None
        self.save()

    def set_default(self, name):
        """Đặt cấu hình mặc định; truyền None để bỏ mặc định."""
        if name is not None and name not in self.profiles:
            raise KeyError(name)
        self.default = name
        self.save()
