import base64
import importlib.util
import json
import re
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace


class Dummy:
    def __init__(self, *args, **kwargs):
        self.__dict__.update(kwargs)

    def __call__(self, *args, **kwargs):
        return Dummy(*args, **kwargs)

    def __getattr__(self, _name):
        return Dummy()


class CoreTorrentInfo:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)

    @property
    def volume_factor(self):
        return f"{self.uploadvolumefactor}/{self.downloadvolumefactor}"

    @property
    def freedate_diff(self):
        return ""


class EnumValue:
    def __init__(self, value):
        self.value = value


class MediaType:
    MOVIE = EnumValue("电影")
    TV = EnumValue("电视剧")
    UNKNOWN = EnumValue("未知")


class Settings:
    USER_AGENT = "UnitTest-UA"
    PROXY = {"https": "proxy"}
    TORRENT_TAG = ""
    TZ = "Asia/Shanghai"


class StringUtils:
    @staticmethod
    def get_url_domain(url):
        from urllib.parse import urlparse

        parsed = urlparse(url if "://" in str(url) else f"https://{url}")
        host = parsed.hostname or ""
        return ".".join(host.split(".")[-2:])

    @staticmethod
    def format_timestamp(value):
        return f"TS:{value}"


def install_module(name, **attrs):
    target = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(target, key, value)
    sys.modules[name] = target
    return target


def load_plugin():
    logger = SimpleNamespace(
        info=lambda *args, **kwargs: None,
        warning=lambda *args, **kwargs: None,
        warn=lambda *args, **kwargs: None,
        error=lambda *args, **kwargs: None,
        debug=lambda *args, **kwargs: None,
    )
    for name in ["apscheduler", "apscheduler.schedulers", "apscheduler.triggers"]:
        install_module(name)
    install_module("apscheduler.schedulers.background", BackgroundScheduler=Dummy)
    install_module("apscheduler.triggers.cron", CronTrigger=Dummy)
    app_module = install_module("app")
    schemas_module = install_module(
        "app.schemas",
        NotificationType=Dummy,
        TorrentInfo=Dummy,
        MediaType=MediaType,
        ServiceInfo=Dummy,
        DownloaderInfo=Dummy,
    )
    app_module.schemas = schemas_module
    install_module("app.chain.torrents", TorrentsChain=Dummy)
    install_module("app.core.config", settings=Settings())
    install_module("app.core.context", MediaInfo=Dummy, TorrentInfo=CoreTorrentInfo)
    install_module("app.core.metainfo", MetaInfo=Dummy)
    install_module("app.db.site_oper", SiteOper=Dummy)
    install_module("app.db.subscribe_oper", SubscribeOper=Dummy)
    install_module("app.helper.downloader", DownloaderHelper=Dummy)
    install_module("app.helper.sites", SitesHelper=Dummy)
    install_module("app.log", logger=logger)
    install_module("app.modules.qbittorrent", Qbittorrent=Dummy)
    install_module("app.modules.transmission", Transmission=Dummy)
    install_module("app.plugins", _PluginBase=object)
    install_module("app.schemas.types", EventType=Dummy)
    install_module("app.utils.http", RequestUtils=Dummy)
    install_module("app.utils.string", StringUtils=StringUtils)

    plugin_path = Path(__file__).parents[1] / "plugins.v2" / "brushflowlowfreq" / "__init__.py"
    spec = importlib.util.spec_from_file_location("brushflow_under_test", plugin_path)
    plugin_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin_module)
    return plugin_module


PLUGIN = load_plugin()


class FakeResponse:
    status_code = 200

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


class MTeamContractTest(unittest.TestCase):
    def setUp(self):
        self.site = SimpleNamespace(
            id=9,
            name="M-Team",
            domain="m-team.cc",
            url="https://kp.m-team.cc/",
            apikey="KEY",
            ua="UA",
            proxy=0,
            pri=1,
            downloader=None,
            timeout=15,
            cookie="COOKIE",
        )
        self.indexer = {
            "id": 9,
            "name": "M-Team",
            "parser": "mTorrent",
            "domain": "https://kp.m-team.cc/",
            "apikey": "KEY",
            "ua": "UA",
            "proxy": 0,
            "timeout": 15,
            "pri": 1,
        }

    def test_category_catalog_and_normalization(self):
        self.assertEqual(PLUGIN.BrushFlowLowFreq.plugin_version, "4.3.4.0")
        self.assertEqual(len(PLUGIN.MTEAM_NORMAL_CATEGORIES), 21)
        self.assertEqual(len(PLUGIN.MTEAM_ADULT_CATEGORIES), 15)
        self.assertEqual(
            PLUGIN.BrushConfig.normalize_mteam_category_whitelist("401, 419，410 401"),
            ["401", "419", "410"],
        )
        self.assertTrue(
            PLUGIN.BrushFlowLowFreq._BrushFlowLowFreq__is_mteam_indexer(self.indexer)
        )
        self.assertTrue(
            PLUGIN.BrushFlowLowFreq._BrushFlowLowFreq__is_mteam_indexer(
                None,
                SimpleNamespace(url="https://kp.m-team.cc/", domain="m-team.cc"),
            )
        )
        self.assertTrue(
            PLUGIN.BrushFlowLowFreq._BrushFlowLowFreq__is_mteam_indexer(
                None,
                SimpleNamespace(url="https://pt.example/", domain="pt.example", name="馒头"),
            )
        )
        fallback = PLUGIN.BrushFlowLowFreq._BrushFlowLowFreq__mteam_indexer_from_siteinfo(
            self.site
        )
        self.assertEqual((fallback["domain"], fallback["apikey"]), (self.site.url, "KEY"))

    def test_form_exposes_complete_whitelist_and_empty_native_default(self):
        plugin = PLUGIN.BrushFlowLowFreq()
        plugin.sites_helper = SimpleNamespace(get_indexers=lambda: [])
        plugin.downloader_helper = SimpleNamespace(get_configs=lambda: {})
        form, defaults = plugin.get_form()

        def find_model(node, model):
            if isinstance(node, dict):
                if (node.get("props") or {}).get("model") == model:
                    return node
                for value in node.values():
                    found = find_model(value, model)
                    if found:
                        return found
            elif isinstance(node, list):
                for value in node:
                    found = find_model(value, model)
                    if found:
                        return found
            return None

        field = find_model(form, "mteam_category_whitelist")
        self.assertIsNotNone(field)
        self.assertEqual(len(field["props"]["items"]), 36)
        self.assertEqual(defaults["mteam_category_whitelist"], [])

    def test_split_requests_strict_filter_promotion_and_download_wrapper(self):
        rows = {
            "normal": [
                {
                    "id": "1",
                    "name": "Movie",
                    "category": "401",
                    "createdDate": "100",
                    "size": "1024",
                    "imdb": "https://imdb.com/title/tt1234567",
                    "status": {
                        "seeders": "2",
                        "leechers": "3",
                        "timesCompleted": "4",
                        "discount": "NORMAL",
                        "promotionRule": {"discount": "FREE", "endTime": "200"},
                    },
                },
                {
                    "id": "outside",
                    "name": "Outside whitelist",
                    "category": "419",
                    "createdDate": "100",
                    "size": "1",
                    "status": {},
                },
            ],
            "adult": [
                {
                    "id": "2",
                    "name": "Adult",
                    "category": 410,
                    "createdDate": "101",
                    "size": "2048",
                    "status": {
                        "seeders": None,
                        "leechers": "5",
                        "timesCompleted": "6",
                        "discount": "PERCENT_50",
                        "mallSingleFree": {"status": "ONGOING", "endDate": "300"},
                    },
                }
            ],
        }

        class FakeRequest:
            calls = []

            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def post_res(self, url, json):
                self.calls.append((url, json, self.kwargs))
                return FakeResponse({"code": "0", "data": {"data": rows[json["mode"]]}})

        PLUGIN.RequestUtils = FakeRequest
        config = PLUGIN.BrushConfig(
            {"mteam_category_whitelist": ["401", "410"]},
            process_site_config=False,
        )
        plugin = PLUGIN.BrushFlowLowFreq()
        plugin.sites_helper = SimpleNamespace(check=lambda _domain: (False, ""))
        plugin.site_oper = SimpleNamespace(success=lambda **_kwargs: None, fail=lambda *_args: None)
        result = plugin._BrushFlowLowFreq__browse_mteam_torrents(
            self.site, self.indexer, config
        )

        self.assertEqual([call[1]["mode"] for call in FakeRequest.calls], ["normal", "adult"])
        self.assertEqual(FakeRequest.calls[0][1]["categories"], ["401"])
        self.assertEqual(FakeRequest.calls[1][1]["categories"], ["410"])
        self.assertTrue(all(call[1]["pageSize"] == 100 for call in FakeRequest.calls))
        self.assertEqual([torrent.title for torrent in result], ["Movie", "Adult"])
        self.assertEqual((result[0].downloadvolumefactor, result[0].freedate), (0, "TS:200"))
        self.assertEqual((result[1].downloadvolumefactor, result[1].freedate), (0, "TS:300"))
        self.assertEqual((result[1].seeders, result[1].peers), (0, 5))

        matched = re.match(r"^\[([^]]+)](.*)$", result[0].enclosure)
        self.assertIsNotNone(matched)
        wrapper = json.loads(base64.b64decode(matched.group(1)).decode("utf-8"))
        self.assertEqual(wrapper["params"], {"id": "1"})
        self.assertEqual(wrapper["header"]["x-api-key"], "KEY")
        self.assertEqual(
            matched.group(2),
            "https://api.m-team.cc/api/torrent/genDlToken",
        )

    def test_http_200_api_error_does_not_leak_unfiltered_results(self):
        class RejectedRequest:
            def __init__(self, **_kwargs):
                pass

            def post_res(self, url, json):
                return FakeResponse({"code": 1, "message": "invalid key", "data": None})

        PLUGIN.RequestUtils = RejectedRequest
        config = PLUGIN.BrushConfig(
            {"mteam_category_whitelist": ["401"]},
            process_site_config=False,
        )
        plugin = PLUGIN.BrushFlowLowFreq()
        plugin.sites_helper = SimpleNamespace(check=lambda _domain: (False, ""))
        plugin.site_oper = SimpleNamespace(success=lambda **_kwargs: None, fail=lambda *_args: None)
        result = plugin._BrushFlowLowFreq__browse_mteam_torrents(
            self.site, self.indexer, config
        )
        self.assertEqual(result, [])

    def test_site_rate_limit_blocks_direct_api_request(self):
        class MustNotRequest:
            def __init__(self, **_kwargs):
                raise AssertionError("rate-limited request must not be created")

        PLUGIN.RequestUtils = MustNotRequest
        config = PLUGIN.BrushConfig(
            {"mteam_category_whitelist": ["401"]},
            process_site_config=False,
        )
        plugin = PLUGIN.BrushFlowLowFreq()
        plugin.sites_helper = SimpleNamespace(check=lambda _domain: (True, "limited"))
        result = plugin._BrushFlowLowFreq__browse_mteam_torrents(
            self.site, self.indexer, config
        )
        self.assertEqual(result, [])

    def test_indexer_lookup_failure_keeps_mteam_whitelist_fail_closed(self):
        class RejectedRequest:
            def __init__(self, **_kwargs):
                pass

            def post_res(self, url, json):
                return FakeResponse({"code": 1, "message": "rejected", "data": None})

        class NativeBrowseMustNotRun:
            @staticmethod
            def browse(**_kwargs):
                raise AssertionError("native browse would bypass the non-empty whitelist")

        def lookup_failure(_domain):
            raise RuntimeError("indexer unavailable")

        PLUGIN.RequestUtils = RejectedRequest
        plugin = PLUGIN.BrushFlowLowFreq()
        plugin._brush_config = PLUGIN.BrushConfig(
            {"mteam_category_whitelist": ["401"]},
            process_site_config=False,
        )
        plugin.site_oper = SimpleNamespace(
            get=lambda _site_id: self.site,
            success=lambda **_kwargs: None,
            fail=lambda *_args: None,
        )
        plugin.sites_helper = SimpleNamespace(
            get_indexer=lookup_failure,
            check=lambda _domain: (False, ""),
        )
        plugin.torrents_chain = NativeBrowseMustNotRun()
        result = plugin._BrushFlowLowFreq__brush_site_torrents(
            siteid=self.site.id,
            torrent_tasks={},
            statistic_info={"count": 0},
            subscribe_titles=set(),
        )
        self.assertTrue(result)


if __name__ == "__main__":
    unittest.main()
