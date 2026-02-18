from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import requests


class SovereignApiError(Exception):
    def __init__(self, message: str, status: int, payload: Any) -> None:
        super().__init__(message)
        self.status = int(status)
        self.payload = payload


@dataclass
class SovereignClient:
    base_url: str = "http://localhost:3001"
    api_key: Optional[str] = None
    timeout: int = 60
    default_headers: Dict[str, str] = field(default_factory=dict)

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = f"{self.base_url.rstrip('/')}{path}"
        headers = {"Accept": "application/json", **self.default_headers}
        if self.api_key and "Authorization" not in headers:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if json_body is not None:
            headers["Content-Type"] = "application/json"

        response = requests.request(
            method=method.upper(),
            url=url,
            headers=headers,
            params=params,
            json=json_body,
            timeout=self.timeout,
        )
        payload: Any
        if "application/json" in (response.headers.get("Content-Type") or "").lower():
            payload = response.json()
        else:
            payload = {"text": response.text}

        if not response.ok:
            message = payload.get("error") if isinstance(payload, dict) else None
            raise SovereignApiError(message or f"HTTP {response.status_code}", response.status_code, payload)
        return payload

    def health(self) -> Any:
        return self._request("GET", "/health")

    def openapi(self) -> Any:
        return self._request("GET", "/api/openapi")

    def list_agents(self, workspace_id: Optional[str] = None) -> Any:
        params = {"workspaceId": workspace_id} if workspace_id else None
        return self._request("GET", "/api/agents", params=params)

    def create_agent(self, payload: Dict[str, Any]) -> Any:
        return self._request("POST", "/api/agents", json_body=payload)

    def execute_company_objective(self, payload: Dict[str, Any]) -> Any:
        return self._request("POST", "/api/company/execute", json_body=payload)

    def list_company_runs(self, workspace_id: Optional[str] = None, status: Optional[str] = None) -> Any:
        params: Dict[str, Any] = {}
        if workspace_id:
            params["workspaceId"] = workspace_id
        if status:
            params["status"] = status
        return self._request("GET", "/api/company/runs", params=params or None)

    def create_autopilot_goal(self, payload: Dict[str, Any]) -> Any:
        return self._request("POST", "/api/autopilot/goals", json_body=payload)

    def get_soul_history(self, agent_id: str, limit: int = 50) -> Any:
        return self._request(
            "GET",
            f"/api/architecture/soul/{agent_id}/history",
            params={"limit": limit},
        )

    def rollback_soul(self, agent_id: str, payload: Optional[Dict[str, Any]] = None) -> Any:
        return self._request(
            "POST",
            f"/api/architecture/soul/{agent_id}/rollback",
            json_body=payload or {},
        )
