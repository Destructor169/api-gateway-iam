# Developer API Gateway & IAM System

This project is a complete Identity and Access Management (IAM) system and API Gateway, built using a microservices architecture. It demonstrates how authentication works at scale, focusing on JSON Web Tokens (JWT), OAuth-like token issuance, and rate limiting.

The Gateway acts as the single point of entry for your microservices, validating tokens and protecting backend services from unauthenticated traffic or abuse.

## Architecture

1. **Auth Service (IAM)**: A Node.js/Express service backed by PostgreSQL. It handles user registration, password hashing (bcrypt), and issues RS256-signed JWTs upon login. It also exposes its public key so other services can verify tokens.
2. **API Gateway**: A Node.js/Express service backed by Redis. It intercepts incoming requests, verifies JWTs using the Auth Service's public key, applies rate limiting (using a token-bucket algorithm via Redis), and proxies requests to backend services.
3. **Demo Service**: A simple protected Node.js backend API that relies entirely on the Gateway for authentication.
4. **PostgreSQL**: Stores user credentials.
5. **Redis**: Stores rate-limiting counters.

## Folder Structure

- `/auth-service`: Contains the source code, Dockerfile, and database initialization scripts for the Identity and Access Management service.
- `/api-gateway`: Contains the source code and Dockerfile for the central API Gateway, including custom middleware for JWT verification and Redis rate limiting.
- `/demo-service`: Contains the source code and Dockerfile for a sample backend service protected by the gateway.
- `/k8s`: Contains Kubernetes manifests (`Deployment` and `Service` files) for deploying the entire stack to a cluster.
- `docker-compose.yml`: Orchestrates the entire system locally, bringing up Postgres, Redis, and all three Node.js services.
- `test.sh`: An automated bash script to test the end-to-end authentication and rate-limiting flows.

## Prerequisites

To run this project locally, you will need:
- [Docker](https://www.docker.com/) and Docker Compose installed.
- (Optional) Node.js 18+ if you want to run services locally outside of Docker.

## How to Run Locally (Docker Compose)

The easiest way to run the entire system is using Docker Compose. It will automatically build the images and wire up the network.

1. Navigate to the project root:
   ```bash
   cd api-gateway-iam
   ```
2. Start the cluster:
   ```bash
   docker-compose up --build
   ```
3. To stop the cluster and remove containers, run:
   ```bash
   docker-compose down
   ```
4. The services will be exposed on the following ports:
   - API Gateway: `http://localhost:3000`
   - Auth Service: `http://localhost:3001`
   - Demo Service: `http://localhost:3002` (Should generally only be accessed via the Gateway)

## How to Run Locally (Standalone Docker Commands)

If you prefer to build and run the Docker containers manually instead of using Docker Compose, you can do so by creating a shared Docker network and running each container individually:

1. **Create a shared network**:
   ```bash
   docker network create iam-network
   ```

2. **Start the Databases**:
   ```bash
   # Start PostgreSQL
   docker run -d --name postgres --network iam-network -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=iam_db -v $(pwd)/auth-service/init.sql:/docker-entrypoint-initdb.d/init.sql -p 5432:5432 postgres:15-alpine
   
   # Start Redis
   docker run -d --name redis --network iam-network -p 6379:6379 redis:7-alpine
   ```

3. **Build and Start Auth Service**:
   ```bash
   docker build -t auth-service ./auth-service
   docker run -d --name auth-service --network iam-network -e PORT=3001 -e DB_USER=postgres -e DB_PASSWORD=password -e DB_NAME=iam_db -e DB_HOST=postgres -e DB_PORT=5432 -p 3001:3001 auth-service
   ```

4. **Build and Start Demo Service**:
   ```bash
   docker build -t demo-service ./demo-service
   docker run -d --name demo-service --network iam-network -e PORT=3002 -p 3002:3002 demo-service
   ```

5. **Build and Start API Gateway**:
   ```bash
   docker build -t api-gateway ./api-gateway
   docker run -d --name api-gateway --network iam-network -e PORT=3000 -e REDIS_HOST=redis -e REDIS_PORT=6379 -e AUTH_SERVICE_URL=http://auth-service:3001 -e DEMO_SERVICE_URL=http://demo-service:3002 -p 3000:3000 api-gateway
   ```

6. **To stop and remove manual containers**:
   ```bash
   docker stop api-gateway demo-service auth-service redis postgres
   docker rm api-gateway demo-service auth-service redis postgres
   docker network rm iam-network
   ```

## Testing the Flow

A comprehensive test script (`test.sh`) is provided to verify the authentication and rate-limiting mechanics.

While the Docker cluster is running, open a new terminal window and run:
```bash
./test.sh
```

The script will automatically:
1. Attempt to access the Demo API without a token (Expect: `401 Unauthorized`).
2. Register a new user in the Auth Service.
3. Log in with the new user and extract the generated JWT.
4. Access the Demo API through the Gateway *with* the JWT (Expect: `200 OK`).
5. Send 10 rapid requests to test rate limiting (Expect: The first 5 succeed, the next 5 fail with `429 Too Many Requests`).

## Kubernetes Deployment

To deploy this stack to a Kubernetes cluster (e.g., Minikube, AWS EKS, Azure AKS):

1. **Build and Push Images**: First, build the Docker images for `auth-service`, `api-gateway`, and `demo-service`, and push them to your container registry (like Docker Hub or AWS ECR).
2. **Update Manifests**: Update the `image` fields in the `k8s/*.yaml` manifests to point to your registry.
3. **Deploy**:
   ```bash
   kubectl apply -f k8s/
   ```
4. The API Gateway is exposed as a `LoadBalancer` service, so it will provision an external IP/DNS depending on your cloud provider.
