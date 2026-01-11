# ExoRTC Deployment Guide (AWS EC2)

This guide assumes you are deploying to an AWS EC2 instance (Ubuntu/Linux) that already hosts another application on port 3000.

## 1. Prerequisites

Ensure your server has the following installed:
- **Node.js** (v16 or higher)
- **PM2** (Process Manager): `npm install -g pm2`
- **NGINX**: `sudo apt install nginx`
- **Git**

## 2. Server Setup & Git Workflow

This guide assumes you want to pull changes from your GitHub repository to the server.

### A. First-Time Setup (On AWS Server)

1.  **Generate SSH Key** (Recommended for private repos):
    ```bash
    ssh-keygen -t ed25519 -C "your_email@example.com"
    # Press Enter to all prompts
    cat ~/.ssh/id_ed25519.pub
    ```
    *Copy the output and add it to your GitHub Repo -> Settings -> Deploy Keys.*

2.  **Clone the Repository**:
    ```bash
    # Go to your home directory or desired folder
    cd ~
    git clone https://github.com/BiigAI/ExoRTC exortc    
    cd exortc/server
    ```

3.  **Install Dependencies**:
    ```bash
    npm install
    ```

4.  **Build the Project**:
    ```bash
    npm run build
    ```
    *This creates the `dist/` folder.*

5.  **Configure Environment**:
    Create a `.env` file in the `server` directory:
    ```bash
    cp .env.example .env
    nano .env
    # Ensure PORT=3001
    ```

## 3. Start with PM2

We use the provided `ecosystem.config.js` which is configured to run the app on **Port 3001** to avoid conflict with your existing service.

1.  **Start the Service**:
    ```bash
    pm2 start ecosystem.config.js --env production
    ```

2.  **Save PM2 List** (so it restarts on reboot):
    ```bash
    pm2 save
    pm2 startup
    ```

3.  **Monitor**:
    ```bash
    pm2 monit
    pm2 logs exortc-server
    ```

## 4. NGINX Configuration

You mentioned you want to use the **same domain**. Since port 3000 is taken, you have two main options:

### Option A: Use a Subdomain (Recommended)
Example: `rtc.yourdomain.com`

1.  Create a new NGINX config:
    ```bash
    sudo nano /etc/nginx/sites-available/exortc
    ```

2.  Paste the following (replace `rtc.yourdomain.com` with your actual subdomain):
    ```nginx
    server {
        listen 80;
        server_name rtc.yourdomain.com;

        location / {
            proxy_pass http://localhost:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }
    }
    ```

3.  Enable it and restart NGINX:
    ```bash
    sudo ln -s /etc/nginx/sites-available/exortc /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl restart nginx
    ```

### Option B: Use a Sub-path (Complex)
Example: `yourdomain.com/rtc`
*Note: This often requires code changes to handle the base path.*

### Finding Your Current Config
If you need to check your existing config, it is likely located at:
- `/etc/nginx/sites-enabled/default`
- OR `/etc/nginx/nginx.conf`
- OR inside `/etc/nginx/conf.d/`

## 5. Updating the Server

To update the code later:

```bash
cd exortc/server
git pull
npm install
npm run build
pm2 restart exortc-server
```
