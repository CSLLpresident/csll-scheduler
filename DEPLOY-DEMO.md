# Put the demo online (free)

This gives you a web link where you and the board can try the app with a made-up league. It takes about 15 minutes and needs no credit card. You'll need a computer (not a tablet) for step 2.

## 1. Unzip
Unzip `csll-scheduler.zip`. You'll get a folder called `csll-scheduler`.

## 2. Put the code on GitHub
1. Go to **github.com** and sign up for a free account, if you don't have one.
2. Click **+** (top right), then **New repository**.
   - Name: `csll-scheduler`
   - Choose **Private**
   - Click **Create repository**
3. On the new, empty repository page, click the link **"uploading an existing file"**.
4. Open the unzipped folder on your computer and select **all the files** (Ctrl + A). There are no subfolders in this version. Drag them onto the GitHub page.
5. Wait for the upload to finish, then click **Commit changes**.

## 3. Turn it on with Render
1. Go to **render.com** and click **Get Started**. Choose **Sign up with GitHub** and allow access to the `csll-scheduler` repository.
2. In the Render dashboard, click **New +**, then **Blueprint**.
3. Pick the `csll-scheduler` repository. Render reads the settings from `render.yaml`: a free web service called `csll-schedules-demo`.
4. Click **Apply** (or **Deploy Blueprint**). The first build takes 3 to 5 minutes.
5. When it says **Live**, open the link at the top. It will look like `https://csll-schedules-demo.onrender.com`.

If the Blueprint option gives you trouble, click **New +**, then **Web Service**, pick the repository, and enter these settings:

| Setting | Value |
| --- | --- |
| Build command | `npm install` |
| Start command | `npm run demo` |
| Instance type | Free |
| Environment variable | `NODE_VERSION` = `22` |

## Using the demo
- The login page has **"Try the app as"** buttons: League admin, Coach, Umpire, Board member who coaches, Board member (no team), and Umpire coordinator. Tap one and the 6-digit code shows on screen.
- In the demo, practices start this week and games start in 3 weeks, so every screen has something on it today.
- After about 15 minutes with no visitors the free server goes to sleep. The next visit takes 30 to 60 seconds to wake it up.
- **Every restart wipes changes** and builds a fresh made-up league.
- Anyone with the link can log in, so **don't add real names or phone numbers** to the demo.

## Updating the demo
When there's a new zip, upload the changed files to the same GitHub repository: **Add file**, then **Upload files**, then **Commit**. Render redeploys on its own.
