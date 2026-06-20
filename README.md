# Advanced Financial Dashboard & API Gateway System

This project is a complete microservices-based financial dashboard. It demonstrates how to build a scalable, secure architecture with an API Gateway acting as a central entry point, Identity and Access Management (IAM) for authentication, and various backend services for market data, news sentiment, and paper trading.

## Architecture

1. **Frontend Dashboard**: A responsive, dark-themed Single Page Application (HTML/CSS/JS) served via NGINX. It provides a premium UI for user registration, API key setup, market overview, charting, news search, and paper trading.
2. **API Gateway**: A Node.js/Express service backed by Redis. It intercepts incoming requests, verifies JWTs using the Auth Service's public key, applies rate limiting (30 requests/min), injects the authenticated `x-user-id` header, and proxies requests to backend services.
3. **Auth Service (IAM)**: A Node.js/Express service backed by PostgreSQL. It handles user registration, password hashing (bcrypt), issues RS256-signed JWTs, and securely manages user API keys (e.g., GNews) with AES-256 encryption.
4. **Finance Service**: A Python/Flask service backed by Redis. It fetches live stock/crypto quotes, historical OHLCV charting data, and trending symbols using `yfinance`. It caches data in Redis and features a graceful fallback to mock data to prevent rate-limit failures.
5. **News Sentiment Service**: A Node.js/Express service. It fetches real-time news based on keyword searches. It uses user-provided GNews API keys for premium news, or falls back to Hacker News. It runs Natural Language Processing (NLP) to score the sentiment of headlines (Positive, Negative, Neutral).
6. **Trading Service**: A Node.js/Express service backed by PostgreSQL. It handles paper trading execution (Buy/Sell) using atomic SQL transactions, and maintains user portfolios and trade histories.
7. **PostgreSQL**: Stores user credentials, encrypted API keys, trades, and portfolio holdings across 5 tables.
8. **Redis**: Stores rate-limiting counters and caches financial market data.

## Folder Structure

- `/frontend`: The UI layer served via NGINX.
- `/backend/auth-service`: IAM service, user management, API key storage.
- `/backend/api-gateway`: Central routing, JWT verification, rate limiting.
- `/backend/finance-service`: Python/Flask market data service.
- `/backend/news-service`: News search and sentiment analysis.
- `/backend/trading-service`: Paper trading execution engine.
- `/k8s`: Kubernetes manifests (`Deployment` and `Service` files) for deploying the stack.
- `docker-compose.yml`: Orchestrates the entire system locally, bringing up Postgres, Redis, the frontend, and all five backend services.

## Prerequisites

To run this project locally, you will need:
- [Docker](https://www.docker.com/) and Docker Compose installed.

## How to Run Locally

The easiest way to run the entire system is using Docker Compose. It will automatically build the images, wire up the network, and initialize the database schemas.

1. Navigate to the project root:
   ```bash
   cd api-gateway-iam
   ```
2. Start the cluster:
   ```bash
   docker-compose up --build -d
   ```
3. To stop the cluster and remove containers, run:
   ```bash
   docker-compose down
   ```

### Accessing the System

Once the cluster is running, the services will be exposed on the following ports:

- **Frontend UI**: [http://localhost:8080](http://localhost:8080) — **Open this in your browser to use the app!**
- **API Gateway**: `http://localhost:3000`
- **Auth Service**: `http://localhost:3001` (Internal)
- **Finance Service**: `http://localhost:3002` (Internal)
- **News Service**: `http://localhost:3003` (Internal)
- **Trading Service**: `http://localhost:3004` (Internal)

### Testing the Dashboard Flow

1. Open [http://localhost:8080](http://localhost:8080) in your browser.
2. Click **Create an account** to register a new user.
3. (Optional) On the Setup screen, provide a free [GNews API Key](https://gnews.io/) for advanced news searches. If you skip this, the system will fall back to Hacker News.
4. **Market Dashboard**: Search for instruments (e.g., `AAPL`, `BTC-USD`, `TSLA`), view live charts, and read sentiment-analyzed news.
5. **Paper Trading**: Use the trading panel to Buy or Sell quantities of the selected instrument.
6. **Portfolio**: Navigate to the Portfolio page using the sidebar to view your current holdings and your full trade history.

## Kubernetes Deployment

To deploy this stack to a Kubernetes cluster (e.g., Minikube, AWS EKS, Azure AKS):

1. **Build and Push Images**: First, build the Docker images for all services and push them to your container registry.
2. **Update Manifests**: Update the `image` fields in the `k8s/*.yaml` manifests to point to your registry.
3. **Deploy**:
   ```bash
   kubectl apply -f k8s/
   ```
4. The API Gateway is exposed as a `LoadBalancer` service, so it will provision an external IP/DNS depending on your cloud provider.
