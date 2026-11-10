"""User runs the consent flow; application never approves its own OAuth grant."""

import argparse
import subprocess
import json
import urllib.request
from google_auth_oauthlib.flow import InstalledAppFlow
from settings import ROOT
from secure_token import save

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
]
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--client", required=True, help="Google Desktop OAuth client JSON path"
    )
    parser.add_argument(
        "--hostinger",
        action="store_true",
        help="Verify and save to the configured Hostinger server through SSH",
    )
    parser.add_argument("--expected-account", help="Only accept this Gmail account")
    args = parser.parse_args()
    flow = InstalledAppFlow.from_client_secrets_file(args.client, scopes=SCOPES)
    creds = flow.run_local_server(
        host="127.0.0.1",
        port=0,
        open_browser=True,
        timeout_seconds=600,
        authorization_prompt_message="Complete Gmail consent in your browser.",
        success_message="Jarvis Gmail authorization completed. You can close this tab.",
        prompt="select_account consent",
        login_hint=args.expected_account or "",
    )
    if args.expected_account:
        request = urllib.request.Request(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            headers={"Authorization": "Bearer " + creds.token},
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            profile = json.load(response)
        if profile.get("emailAddress", "").lower() != args.expected_account.lower():
            raise SystemExit(
                "Wrong Gmail account selected. No credentials were changed."
            )
    save(ROOT / ".private/gmail-token.dpapi", creds.to_json())
    print("Gmail authorization saved using Windows DPAPI.")
    if args.hostinger:
        result = subprocess.run(
            [
                "ssh",
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                "ConnectTimeout=10",
                "root@187.127.214.171",
                "python3",
                "/docker/jarvis-integration/configure-gmail.py",
                *([args.expected_account] if args.expected_account else []),
            ],
            input=creds.to_json(),
            text=True,
            capture_output=True,
            timeout=40,
        )
        status = result.stdout.strip()
        if result.returncode == 0 and status == "GMAIL_SERVER_CONNECTED":
            print(status)
        else:
            print(
                "Gmail local authorization completed, but server setup needs checking."
            )
            raise SystemExit(1)
