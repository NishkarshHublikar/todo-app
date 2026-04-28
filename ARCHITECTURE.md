# Todo App Architecture Guide

This project is a modern, containerized Todo application utilizing **Node.js**, **Redis**, and **Supabase (PostgreSQL)**.

## 🏗️ Docker Containerization

The application is split into three main services, orchestrated via `docker-compose.yml`:

1.  **Frontend (Nginx)**:
    -   Serves static HTML/JS/CSS.
    -   Uses a custom `docker-entrypoint.sh` to inject production environment variables into a global `window.ENV` object at runtime. This avoids baking secrets into the Docker image.
2.  **Backend (Node.js/Express)**:
    -   High-performance API handling business logic.
    -   Uses a multi-stage Docker build to keep the production image small and secure.
    -   Runs as a non-privileged user (`appuser`) for enhanced security.
3.  **Redis**:
    -   Fast, in-memory data store used for caching.
    -   **Hardened**: Port 6379 is bound to `127.0.0.1` so it is not exposed to the public internet.

## 🚀 Redis Caching Strategy

We use a **Read-Through** caching strategy to significantly reduce latency and database load.

### How it works:
1.  **Request comes in**: Check Redis for the data first.
2.  **Cache Hit**: Return the cached data instantly (ms response time).
3.  **Cache Miss**: Fetch data from Supabase, store it in Redis (with a TTL), and return it to the user.
4.  **Automatic Invalidation**: Whenever a todo is created, updated, or deleted, we purge the cache for that user to ensure consistency.

### Implementation:
We've implemented a `withCache` utility that simplifies this pattern:
```javascript
const data = await withCache(key, async () => {
    // Database logic here
    return result;
}, TTL_SECONDS);
```

## 🔐 Security Summary

-   **Secrets**: All sensitive keys are loaded via a `.env` file and never exposed to the client.
-   **Resource Isolation**: Services communicate over a private Docker network.
-   **Data Ownership**: Every API route verifies that the requester owns the data they are trying to access.
