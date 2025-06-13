from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import merge, clean, process, calculate, predict, anomalies, cluster

app = FastAPI(title="Data Processing API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(merge.router, prefix="/merge-datasets")
app.include_router(clean.router, prefix="/clean-dataset")
app.include_router(process.router, prefix="/process-data")
app.include_router(calculate.router, prefix="/calculate-column")
app.include_router(predict.router, prefix="/predict")
app.include_router(anomalies.router, prefix="/detect-anomalies")
app.include_router(cluster.router, prefix="/cluster")

@app.get("/")
async def root():
    """Root endpoint for API health check."""
    return {"message": "Data Processing API is running"}