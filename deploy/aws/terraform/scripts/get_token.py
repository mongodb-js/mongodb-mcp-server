#!/usr/bin/env python3
"""
get_token.py — Generate a Cognito OAuth2 ID token for testing the
               MongoDB MCP Server deployed on AWS Bedrock AgentCore.

Usage:
    python3 get_token.py \
        --region us-east-1 \
        --user-pool-id us-east-1_XXXXXXXXX \
        --client-id XXXXXXXXXXXXXXXXXXXXXXXXXX \
        --username mcp-test-user \
        --password "MySecretP@ssword1"

    # Or read credentials from environment variables:
    export COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
    export COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
    export COGNITO_USERNAME=mcp-test-user
    export COGNITO_PASSWORD="MySecretP@ssword1"
    python3 get_token.py --region us-east-1

The script handles the NEW_PASSWORD_REQUIRED challenge that Cognito raises on
first sign-in when a temporary password was set via Terraform/the AWS console.
In that case, pass --new-password to set a permanent password in one step.

Output (JSON):
    {
      "access_token": "...",
      "id_token": "...",
      "refresh_token": "...",
      "expires_in": 3600,
      "token_type": "Bearer"
    }
"""

from __future__ import annotations

import argparse
import json
import os
import sys

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    print("ERROR: boto3 is required. Install it with:  pip install boto3", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def initiate_auth(cognito: "boto3.client", client_id: str, username: str, password: str) -> dict:
    """Start USER_PASSWORD_AUTH flow and return the raw Cognito response."""
    return cognito.initiate_auth(
        AuthFlow="USER_PASSWORD_AUTH",
        AuthParameters={
            "USERNAME": username,
            "PASSWORD": password,
        },
        ClientId=client_id,
    )


def respond_to_new_password_challenge(
    cognito: "boto3.client",
    client_id: str,
    username: str,
    session: str,
    new_password: str,
) -> dict:
    """Satisfy the NEW_PASSWORD_REQUIRED challenge."""
    return cognito.respond_to_auth_challenge(
        ChallengeName="NEW_PASSWORD_REQUIRED",
        ClientId=client_id,
        Session=session,
        ChallengeResponses={
            "USERNAME": username,
            "NEW_PASSWORD": new_password,
        },
    )


def get_tokens(
    region: str,
    user_pool_id: str,
    client_id: str,
    username: str,
    password: str,
    new_password: str | None = None,
) -> dict:
    """
    Authenticate against Cognito and return access / id / refresh tokens.

    Handles the NEW_PASSWORD_REQUIRED challenge automatically when
    `new_password` is provided; raises RuntimeError otherwise.
    """
    cognito = boto3.client("cognito-idp", region_name=region)

    try:
        resp = initiate_auth(cognito, client_id, username, password)
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        msg  = exc.response["Error"]["Message"]
        raise RuntimeError(f"Cognito auth failed [{code}]: {msg}") from exc

    # ---- Handle challenges ----
    challenge = resp.get("ChallengeName")

    if challenge == "NEW_PASSWORD_REQUIRED":
        if not new_password:
            raise RuntimeError(
                "Cognito requires a new password (NEW_PASSWORD_REQUIRED challenge). "
                "Re-run with --new-password <permanent-password>."
            )
        try:
            resp = respond_to_new_password_challenge(
                cognito, client_id, username, resp["Session"], new_password
            )
        except ClientError as exc:
            code = exc.response["Error"]["Code"]
            msg  = exc.response["Error"]["Message"]
            raise RuntimeError(f"Failed to set new password [{code}]: {msg}") from exc

    elif challenge is not None:
        raise RuntimeError(
            f"Unhandled Cognito challenge: {challenge}. "
            "Complete this challenge manually in the AWS console before retrying."
        )

    auth_result = resp.get("AuthenticationResult", {})
    if not auth_result:
        raise RuntimeError(f"No AuthenticationResult in Cognito response: {resp}")

    return {
        "access_token":  auth_result["AccessToken"],
        "id_token":      auth_result["IdToken"],
        "refresh_token": auth_result.get("RefreshToken", ""),
        "expires_in":    auth_result["ExpiresIn"],
        "token_type":    auth_result["TokenType"],
    }


# ---------------------------------------------------------------------------
# Convenience: decode and print token claims (without verification)
# ---------------------------------------------------------------------------

def _decode_jwt_payload(token: str) -> dict:
    """Base64-decode the JWT payload (no signature verification)."""
    import base64
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    # Pad to a multiple of 4
    payload += "=" * (-len(payload) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        return {}


def print_token_info(tokens: dict) -> None:
    claims = _decode_jwt_payload(tokens["id_token"])
    print("\n--- Token claims (id_token) ---", file=sys.stderr)
    for key in ("sub", "email", "cognito:username", "exp", "iat", "iss", "aud"):
        if key in claims:
            import datetime
            val = claims[key]
            if key in ("exp", "iat"):
                val = f"{val}  ({datetime.datetime.utcfromtimestamp(val).isoformat()}Z)"
            print(f"  {key}: {val}", file=sys.stderr)
    print(
        f"\nToken expires in {tokens['expires_in']}s "
        f"(type: {tokens['token_type']})\n",
        file=sys.stderr,
    )


# ---------------------------------------------------------------------------
# Example: invoke AgentCore runtime with the token
# ---------------------------------------------------------------------------

def invoke_agentcore(
    region: str,
    runtime_arn: str,
    id_token: str,
    payload: dict | None = None,
) -> None:
    """
    Example helper: call the AgentCore MCP runtime with the obtained token.

    Requires: pip install requests
    """
    try:
        import urllib.parse
        import urllib.request
    except ImportError:
        print("urllib not available", file=sys.stderr)
        return

    encoded_arn = urllib.parse.quote(runtime_arn, safe="")
    url = (
        f"https://bedrock-agentcore.{region}.amazonaws.com"
        f"/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"
    )
    body = json.dumps(payload or {"jsonrpc": "2.0", "method": "tools/list", "id": 1}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {id_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    print(f"\n--- AgentCore invocation: {url} ---", file=sys.stderr)
    try:
        with urllib.request.urlopen(req) as resp:  # noqa: S310
            result = json.loads(resp.read())
            print(json.dumps(result, indent=2))
    except urllib.error.HTTPError as exc:
        print(f"HTTP {exc.code}: {exc.read().decode()}", file=sys.stderr)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Generate a Cognito OAuth2 token for the MongoDB MCP Server on AgentCore.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--region",        default=os.getenv("AWS_REGION", "us-east-1"),            help="AWS region (default: us-east-1 or $AWS_REGION)")
    p.add_argument("--user-pool-id",  default=os.getenv("COGNITO_USER_POOL_ID", ""),           help="Cognito user pool ID ($COGNITO_USER_POOL_ID)")
    p.add_argument("--client-id",     default=os.getenv("COGNITO_CLIENT_ID", ""),              help="Cognito app client ID ($COGNITO_CLIENT_ID)")
    p.add_argument("--username",      default=os.getenv("COGNITO_USERNAME", ""),               help="Cognito username ($COGNITO_USERNAME)")
    p.add_argument("--password",      default=os.getenv("COGNITO_PASSWORD", ""),               help="Cognito password ($COGNITO_PASSWORD)")
    p.add_argument("--new-password",  default=os.getenv("COGNITO_NEW_PASSWORD", ""),           help="Permanent password to set when NEW_PASSWORD_REQUIRED is raised")
    p.add_argument("--runtime-arn",   default=os.getenv("AGENTCORE_RUNTIME_ARN", ""),          help="(Optional) AgentCore runtime ARN – triggers a tools/list invocation to smoke-test the token")
    p.add_argument("--output",        choices=["json", "id_token", "access_token"],            default="json", help="Output format (default: json)")
    p.add_argument("--verbose", "-v", action="store_true",                                     help="Print decoded token claims to stderr")
    return p


def main() -> None:
    args = build_parser().parse_args()

    # Validate required arguments
    missing = [f for f, v in [
        ("--user-pool-id", args.user_pool_id),
        ("--client-id",    args.client_id),
        ("--username",     args.username),
        ("--password",     args.password),
    ] if not v]
    if missing:
        print(f"ERROR: missing required arguments: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    try:
        tokens = get_tokens(
            region       = args.region,
            user_pool_id = args.user_pool_id,
            client_id    = args.client_id,
            username     = args.username,
            password     = args.password,
            new_password = args.new_password or None,
        )
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.verbose:
        print_token_info(tokens)

    # Output
    if args.output == "json":
        print(json.dumps(tokens, indent=2))
    elif args.output == "id_token":
        print(tokens["id_token"])
    elif args.output == "access_token":
        print(tokens["access_token"])

    # Optional smoke-test invocation
    if args.runtime_arn:
        invoke_agentcore(args.region, args.runtime_arn, tokens["id_token"])


if __name__ == "__main__":
    main()
