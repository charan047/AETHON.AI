import random
import string
import time

import httpx

from locust import HttpUser, between, task


def random_string(n: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase, k=n))


class AuthenticatedUser(HttpUser):
    """Simulates a logged-in user using the platform."""

    wait_time = between(1, 3)

    def on_start(self):
        """Register, login, and attach org context headers."""
        email = f"loadtest_{random_string()}@test.com"
        password = "LoadTestPass123!"
        self.headers = {}
        self.org_id = None

        with httpx.Client(base_url=self.host, timeout=10.0) as client:
            client.post(
                "/api/auth/register",
                json={
                    "email": email,
                    "password": password,
                    "full_name": "Load Test User",
                },
            )

            token = None
            for attempt in range(5):
                response = client.post(
                    "/api/auth/login",
                    json={
                        "email": email,
                        "password": password,
                    },
                )
                if response.status_code == 200:
                    payload = response.json()
                    token = payload.get("access_token")
                    break
                if response.status_code != 429:
                    break
                time.sleep(min(2**attempt, 5))

            if not token:
                return

            org_response = client.get(
                "/api/organizations/me",
                headers={"Authorization": f"Bearer {token}"},
            )
            orgs = org_response.json() if org_response.status_code == 200 else []
            self.org_id = orgs[0]["id"] if orgs else None
            self.headers = {"Authorization": f"Bearer {token}"}
            if self.org_id:
                self.headers["X-Org-Id"] = self.org_id

    @task(10)
    def list_agents(self):
        if not self.headers:
            return
        self.client.get("/api/agents", headers=self.headers, name="/api/agents [LIST]")

    @task(10)
    def list_workflows(self):
        if not self.headers:
            return
        self.client.get("/api/workflows", headers=self.headers, name="/api/workflows [LIST]")

    @task(5)
    def dashboard_summary(self):
        if not self.headers:
            return
        self.client.get(
            "/api/dashboard/summary",
            headers=self.headers,
            name="/api/dashboard/summary",
        )

    @task(3)
    def marketplace_browse(self):
        self.client.get("/api/marketplace?limit=20", name="/api/marketplace [BROWSE]")

    @task(1)
    def get_analytics(self):
        if not self.headers:
            return
        self.client.get(
            "/api/analytics/overview",
            headers=self.headers,
            name="/api/analytics/overview",
        )


class UnauthenticatedUser(HttpUser):
    """Simulates public marketplace browsing."""

    wait_time = between(2, 5)

    @task(10)
    def browse_marketplace(self):
        self.client.get("/api/marketplace", name="/api/marketplace [PUBLIC]")

    @task(5)
    def search_marketplace(self):
        queries = ["support", "development", "finance", "marketing"]
        q = random.choice(queries)
        self.client.get(f"/api/marketplace?query={q}", name="/api/marketplace [SEARCH]")

    @task(3)
    def view_listing(self):
        response = self.client.get("/api/marketplace?limit=1", name="/api/marketplace [DETAIL_LOOKUP]")
        if response.status_code != 200:
            return
        items = response.json().get("items", [])
        if not items:
            return
        slug = items[0].get("slug")
        if slug:
            self.client.get(f"/api/marketplace/{slug}", name="/api/marketplace/:slug [DETAIL]")
