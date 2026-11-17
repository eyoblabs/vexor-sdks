"""Integration tests against live Vexor server."""

import os
import unittest
from vexor_video import Vexor, NotFoundError


@unittest.skipUnless(os.environ.get("VEXOR_TEST_API_KEY"), "set VEXOR_TEST_API_KEY to run live API checks")
class TestLiveApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = Vexor(
            api_key=os.environ["VEXOR_TEST_API_KEY"],
            base_url=os.environ.get("VEXOR_TEST_BASE_URL", "http://localhost:8080"),
        )

    def test_list_assets(self):
        assets = self.client.assets.list()
        self.assertIsInstance(assets, list)

    def test_get_asset(self):
        assets = self.client.assets.list()
        if not assets:
            self.skipTest("No assets exist for the configured account")
        first_asset = assets[0]
        fetched = self.client.assets.get(first_asset["id"])
        self.assertEqual(fetched["id"], first_asset["id"])
        self.assertIn("state", fetched)

    def test_get_nonexistent_asset(self):
        with self.assertRaises(NotFoundError):
            self.client.assets.get("00000000-0000-0000-0000-000000000000")

    def test_create_playback_token(self):
        # Find a ready asset
        assets = self.client.assets.list()
        ready_assets = [a for a in assets if a.get("state") == "ready"]
        if not ready_assets:
            self.skipTest("No ready asset found to test playback token")

        asset_id = ready_assets[0]["id"]
        token_data = self.client.tokens.create(
            asset_id=asset_id,
            viewer_id="student_live_test",
        )
        self.assertIn("token", token_data)
        self.assertIn("manifest_url", token_data)
        self.assertIn("master.m3u8", token_data["manifest_url"])


if __name__ == "__main__":
    unittest.main()
