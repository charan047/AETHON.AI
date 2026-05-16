# OAuth Setup

This guide walks through the two first-class OAuth integrations in Aethon Agency OS:

- Gmail
- Slack

After setup, new users can connect each provider with one click from `/integrations`.

## Redirect URI

For local development, use this redirect URI for both providers:

```text
http://localhost:5173/integrations/oauth/callback
```

If you deploy Aethon to production, replace `localhost:5173` with your real frontend origin.

## Environment Variables

Add these to `backend/.env`:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:5173/integrations/oauth/callback

SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_OAUTH_REDIRECT_URI=http://localhost:5173/integrations/oauth/callback
```

## Gmail OAuth Setup

### 1. Open Google Cloud Console

Go to:

```text
https://console.cloud.google.com/
```

Create a new project or select an existing one for Aethon.

### 2. Enable the Gmail API

In the left sidebar:

1. Open `APIs & Services`
2. Click `Library`
3. Search for `Gmail API`
4. Click `Enable`

Screenshot description:

- You should see a product page titled `Gmail API`
- The primary action button changes from `Enable` to `Manage` when it is active

### 3. Configure the OAuth consent screen

In `APIs & Services`:

1. Open `OAuth consent screen`
2. Choose `External` for local development
3. Fill in app name, support email, and developer contact
4. Add your own Google account as a test user

Screenshot description:

- The app info form should show fields for app name and support email
- The test users section should contain the Google accounts allowed to approve the app

### 4. Create OAuth credentials

In `APIs & Services`:

1. Open `Credentials`
2. Click `Create Credentials`
3. Choose `OAuth client ID`
4. Application type: `Web application`
5. Add the redirect URI:

```text
http://localhost:5173/integrations/oauth/callback
```

Copy:

- Client ID
- Client Secret

### 5. Gmail scopes used by Aethon

Aethon requests:

- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.compose`

Why:

- send emails through agent tools
- inspect inbox context
- create drafts for safer approval-based workflows

### 6. Free tier / limits

For most local development and early testing, Google’s OAuth flow itself is free.

Operational notes:

- Gmail API has usage quotas per Google Cloud project
- test-mode apps are limited to configured test users until you publish the consent screen

### 7. Production notes

Before production:

- switch redirect URIs to your production frontend domain
- verify your OAuth consent screen if Google requires it for sensitive scopes
- keep client secrets only in backend/server environment variables

## Slack OAuth Setup

### 1. Create a Slack app

Go to:

```text
https://api.slack.com/apps
```

Click `Create New App`, then choose `From scratch`.

### 2. Configure OAuth & permissions

Inside your Slack app:

1. Open `OAuth & Permissions`
2. Add this redirect URI:

```text
http://localhost:5173/integrations/oauth/callback
```

3. Add bot scopes:
   - `chat:write`
   - `channels:read`
   - `im:read`
   - `im:write`

Screenshot description:

- The redirect URI area should list the local callback URL
- The bot token scopes table should show the four scopes above

### 3. Install the app to your workspace

From `OAuth & Permissions`, click:

```text
Install to Workspace
```

Slack shows the consent screen for the workspace admin or member with permission.

### 4. Copy credentials

From the app settings, copy:

- Client ID
- Client Secret

Place them in `backend/.env`.

### 5. Free tier / limits

Slack app creation and OAuth setup are free.

Operational notes:

- workspace policies may limit who can install apps
- production workspaces may require admin approval for scopes

### 6. Production notes

Before production:

- use your real frontend callback URL
- install the Slack app in the production workspace
- rotate client secrets if they were ever exposed during testing

## Verifying the Flow

After config:

1. Start Aethon with `docker compose up`
2. Open `/integrations`
3. Click `Connect Gmail`
4. Complete consent
5. Confirm the page shows `Connected`
6. Click `Test`

Repeat the same flow for Slack.

## Common Problems

### Redirect URI mismatch

Symptom:

- provider rejects login before consent completes

Fix:

- ensure the provider console redirect URI exactly matches the frontend callback URL

### Missing refresh token for Gmail

Symptom:

- Gmail works once, then expires and cannot refresh

Fix:

- reconnect Gmail
- ensure offline access is requested and the consent flow was completed again

### Slack install succeeds but Aethon shows disconnected

Symptom:

- Slack OAuth consent completes but no integration appears

Fix:

- verify `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and redirect URI values
- inspect backend logs for OAuth callback errors
