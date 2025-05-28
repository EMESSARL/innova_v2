from fastapi import APIRouter, HTTPException
import pandas as pd
import io
from pydantic import BaseModel, field_validator, ValidationInfo
from typing import Any
from datetime import datetime
from sklearn.cluster import KMeans, AgglomerativeClustering, DBSCAN, OPTICS
from sklearn.preprocessing import (
    StandardScaler,
    MinMaxScaler,
    RobustScaler,
    OneHotEncoder,
    LabelEncoder,
)
from sklearn.impute import SimpleImputer
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE
from umap import UMAP
from sklearn.metrics import silhouette_score, davies_bouldin_score
from app.utils.minio_client import MinioClient
import numpy as np

router = APIRouter()


class KMeansParams(BaseModel):
    """Paramètres pour K-means."""

    n_clusters: int = 8
    max_iter: int = 300
    init: str = "k-means++"
    n_init: int = 10

    @field_validator("n_clusters")
    def validate_n_clusters(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("n_clusters doit être positif")
        return v

    @field_validator("max_iter")
    def validate_max_iter(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("max_iter doit être positif")
        return v

    @field_validator("init")
    def validate_init(cls, v: str) -> str:
        if v not in ["k-means++", "random"]:
            raise ValueError("init doit être 'k-means++' ou 'random'")
        return v

    @field_validator("n_init")
    def validate_n_init(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("n_init doit être positif")
        return v


class HierarchicalParams(BaseModel):
    """Paramètres pour clustering hiérarchique."""

    n_clusters: int | None = None
    linkage: str = "ward"
    distance_threshold: float | None = None

    @field_validator("n_clusters")
    def validate_n_clusters(cls, v: int | None, info: ValidationInfo) -> int | None:
        if v is None and info.data.get("distance_threshold") is None:
            raise ValueError("n_clusters ou distance_threshold doit être spécifié")
        if v is not None and v <= 0:
            raise ValueError("n_clusters doit être positif")
        return v

    @field_validator("linkage")
    def validate_linkage(cls, v: str) -> str:
        if v not in ["ward", "complete", "average", "single"]:
            raise ValueError(
                "linkage doit être 'ward', 'complete', 'average' ou 'single'"
            )
        return v

    @field_validator("distance_threshold")
    def validate_distance_threshold(cls, v: float | None) -> float | None:
        if v is not None and v <= 0:
            raise ValueError("distance_threshold doit être positif")
        return v


class DBSCANParams(BaseModel):
    """Paramètres pour DBSCAN."""

    eps: float = 0.5
    min_samples: int = 5
    metric: str = "euclidean"

    @field_validator("eps")
    def validate_eps(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("eps doit être positif")
        return v

    @field_validator("min_samples")
    def validate_min_samples(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("min_samples doit être positif")
        return v

    @field_validator("metric")
    def validate_metric(cls, v: str) -> str:
        if v not in ["euclidean", "manhattan", "cosine"]:
            raise ValueError("metric doit être 'euclidean', 'manhattan' ou 'cosine'")
        return v


class OPTICSParams(BaseModel):
    """Paramètres pour OPTICS."""

    min_samples: int = 5
    xi: float = 0.05
    metric: str = "euclidean"

    @field_validator("min_samples")
    def validate_min_samples(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("min_samples doit être positif")
        return v

    @field_validator("xi")
    def validate_xi(cls, v: float) -> float:
        if not 0 < v < 1:
            raise ValueError("xi doit être dans ]0, 1[")
        return v

    @field_validator("metric")
    def validate_metric(cls, v: str) -> str:
        if v not in ["euclidean", "manhattan", "cosine"]:
            raise ValueError("metric doit être 'euclidean', 'manhattan' ou 'cosine'")
        return v


class Preprocessing(BaseModel):
    """Paramètres de prétraitement des données."""

    scaling: str = "none"
    encoding: str = "none"
    imputation: str = "drop"
    dimensionality_reduction: str = "none"
    n_components: int = 2

    @field_validator("scaling")
    def validate_scaling(cls, v: str) -> str:
        if v not in ["none", "standard", "minmax", "robust"]:
            raise ValueError(
                "scaling doit être 'none', 'standard', 'minmax' ou 'robust'"
            )
        return v

    @field_validator("encoding")
    def validate_encoding(cls, v: str) -> str:
        if v not in ["none", "onehot", "label"]:
            raise ValueError("encoding doit être 'none', 'onehot' ou 'label'")
        return v

    @field_validator("imputation")
    def validate_imputation(cls, v: str) -> str:
        if v not in ["drop", "mean", "median"]:
            raise ValueError("imputation doit être 'drop', 'mean' ou 'median'")
        return v

    @field_validator("dimensionality_reduction")
    def validate_dimensionality_reduction(cls, v: str) -> str:
        if v not in ["none", "PCA", "t-SNE", "UMAP"]:
            raise ValueError(
                "dimensionality_reduction doit être 'none', 'PCA', 't-SNE' ou 'UMAP'"
            )
        return v

    @field_validator("n_components")
    def validate_n_components(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("n_components doit être positif")
        return v


class ClusterParameters(BaseModel):
    """Paramètres pour le clustering."""

    dataset_id: int
    algorithm: str
    parameters: KMeansParams | HierarchicalParams | DBSCANParams | OPTICSParams
    preprocessing: Preprocessing | None = None
    features: list[str] | None = None
    auto_cluster_selection: bool = False
    metrics: list[str] = ["silhouette"]
    output_format: str

    @field_validator("algorithm")
    def validate_algorithm(cls, v: str) -> str:
        if v not in ["kmeans", "hierarchical", "dbscan", "optics"]:
            raise ValueError(
                "algorithme doit être 'kmeans', 'hierarchical', 'dbscan' ou 'optics'"
            )
        return v

    @field_validator("metrics")
    def validate_metrics(cls, v: list[str]) -> list[str]:
        valid_metrics = ["silhouette", "inertia", "davies_bouldin"]
        if not all(m in valid_metrics for m in v):
            raise ValueError(
                "metrics doit contenir 'silhouette', 'inertia' ou 'davies_bouldin'"
            )
        return v

    @field_validator("output_format")
    def validate_output_format(cls, v: str) -> str:
        if v not in ["csv", "excel", "json"]:
            raise ValueError("output_format doit être 'csv', 'excel' ou 'json'")
        return v


class RequestBody(BaseModel):
    """Corps de la requête pour le clustering."""

    parameters: ClusterParameters
    metadata: dict[str, Any]


def preprocess_data(
    df: pd.DataFrame, preprocessing: Preprocessing, features: list[str] | None
) -> pd.DataFrame:
    """
    Applique le prétraitement (imputation, encoding, scaling, réduction de dimension) au DataFrame.

    Args:
        df: DataFrame à prétraiter.
        preprocessing: Paramètres de prétraitement.
        features: Colonnes à utiliser.

    Returns:
        DataFrame prétraité.

    Raises:
        ValueError: Si le prétraitement est invalide ou les types de colonnes sont incompatibles.
    """
    df_processed = df.copy()
    selected_cols = (
        features if features else df.select_dtypes(include=["float64", "int64"]).columns
    )
    if not selected_cols:
        raise ValueError("Aucune colonne numérique détectée")

    df_processed = df_processed[selected_cols]
    numeric_cols = df_processed.select_dtypes(include=["float64", "int64"]).columns
    categorical_cols = df_processed.select_dtypes(
        include=["object", "category"]
    ).columns

    # Imputation
    if preprocessing.imputation != "drop":
        if numeric_cols.empty:
            raise ValueError("Aucune colonne numérique pour l'imputation")
        imputer = SimpleImputer(strategy=preprocessing.imputation)
        df_processed[numeric_cols] = imputer.fit_transform(df_processed[numeric_cols])
    else:
        df_processed = df_processed.dropna()

    # Encoding
    if preprocessing.encoding != "none" and not categorical_cols.empty:
        if preprocessing.encoding == "onehot":
            encoder = OneHotEncoder(sparse_output=False, handle_unknown="ignore")
            encoded = encoder.fit_transform(df_processed[categorical_cols])
            encoded_cols = encoder.get_feature_names_out(categorical_cols)
            df_encoded = pd.DataFrame(
                encoded, columns=encoded_cols, index=df_processed.index
            )
            df_processed = pd.concat(
                [df_processed.drop(columns=categorical_cols), df_encoded], axis=1
            )
        elif preprocessing.encoding == "label":
            for col in categorical_cols:
                encoder = LabelEncoder()
                df_processed[col] = encoder.fit_transform(df_processed[col].astype(str))
    elif preprocessing.encoding != "none" and categorical_cols.empty:
        raise ValueError("Aucune colonne catégorique pour l'encodage")

    # Scaling
    if preprocessing.scaling != "none":
        if numeric_cols.empty:
            raise ValueError("Aucune colonne numérique pour le scaling")
        scaler = {
            "standard": StandardScaler(),
            "minmax": MinMaxScaler(),
            "robust": RobustScaler(),
        }[preprocessing.scaling]
        df_processed[numeric_cols] = scaler.fit_transform(df_processed[numeric_cols])

    # Réduction de dimension
    if preprocessing.dimensionality_reduction != "none":
        n_components = min(preprocessing.n_components, df_processed.shape[1])
        if preprocessing.dimensionality_reduction == "PCA":
            reducer = PCA(n_components=n_components)
            reduced_data = reducer.fit_transform(df_processed)
            df_processed = pd.DataFrame(
                reduced_data, columns=[f"component_{i}" for i in range(n_components)]
            )
        elif preprocessing.dimensionality_reduction == "t-SNE":
            reducer = TSNE(n_components=n_components, random_state=42)
            reduced_data = reducer.fit_transform(df_processed)
            df_processed = pd.DataFrame(
                reduced_data, columns=[f"component_{i}" for i in range(n_components)]
            )
        elif preprocessing.dimensionality_reduction == "UMAP":
            reducer = UMAP(n_components=n_components, random_state=42)
            reduced_data = reducer.fit_transform(df_processed)
            df_processed = pd.DataFrame(
                reduced_data, columns=[f"component_{i}" for i in range(n_components)]
            )

    return df_processed


def select_optimal_clusters(
    X: pd.DataFrame, algorithm: str, params: KMeansParams | HierarchicalParams
) -> int:
    """
    Sélectionne le nombre optimal de clusters via la méthode elbow ou silhouette.

    Args:
        X: Données à analyser.
        algorithm: Algorithme de clustering.
        params: Paramètres de l'algorithme.

    Returns:
        Nombre optimal de clusters.
    """
    if algorithm not in ["kmeans", "hierarchical"]:
        raise ValueError(
            "auto_cluster_selection n'est supporté que pour kmeans et hierarchical"
        )

    max_k = min(10, len(X) - 1)
    silhouette_scores = []
    for k in range(2, max_k + 1):
        if algorithm == "kmeans":
            model = KMeans(
                n_clusters=k,
                **params.model_dump(exclude={"n_clusters"}),
                random_state=42,
            )
        else:  # hierarchical
            model = AgglomerativeClustering(
                n_clusters=k,
                **params.model_dump(exclude={"n_clusters", "distance_threshold"}),
            )
        labels = model.fit_predict(X)
        if len(set(labels)) > 1:
            score = silhouette_score(X, labels)
            silhouette_scores.append((k, score))
        else:
            silhouette_scores.append((k, -1))

    if not silhouette_scores:
        raise ValueError("Impossible de déterminer le nombre optimal de clusters")
    return max(silhouette_scores, key=lambda x: x[1])[0]


def compute_metrics(
    X: pd.DataFrame, labels: np.ndarray, metrics: list[str], model: Any = None
) -> dict[str, float]:
    """
    Calcule les métriques demandées pour le clustering.

    Args:
        X: Données utilisées pour le clustering.
        labels: Étiquettes des clusters.
        metrics: Liste des métriques à calculer.

    Returns:
        Dictionnaire des métriques.
    """
    results = {}
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    if n_clusters < 2:
        return {m: 0.0 for m in metrics}

    for metric in metrics:
        if metric == "silhouette":
            results["silhouette"] = silhouette_score(X, labels)
        elif metric == "inertia" and hasattr(model, "inertia_"):
            results["inertia"] = model.inertia_
        elif metric == "davies_bouldin":
            results["davies_bouldin"] = davies_bouldin_score(X, labels)
    return results


@router.post("/")
async def cluster(body: RequestBody) -> dict[str, Any]:
    """
    Regroupe les données d’un dataset en clusters en utilisant un algorithme de clustering.

    Args:
        body: Corps de la requête contenant les paramètres et métadonnées.

    Returns:
        Dictionnaire avec le chemin du résultat dans MinIO et les métadonnées.

    Raises:
        HTTPException: Si le fichier est introuvable, l'algorithme est invalide, ou les données sont incompatibles.
    """
    minio_client = MinioClient()
    params = body.parameters
    metadata = body.metadata
    user_id = metadata["user_id"]

    # Vérifier l'accès au fichier
    file_info = next(
        (f for f in metadata["files"] if f["dataset_id"] == params.dataset_id),
        None,
    )
    if not file_info:  # or not file_info["path"].startswith(f"datasets/{user_id}/"):
        raise HTTPException(status_code=403, detail="Accès non autorisé au fichier")

    # Charger le dataset depuis MinIO
    try:
        data = minio_client.download_file(file_info["path"])
        if file_info["format"] == "csv":
            df = pd.read_csv(io.BytesIO(data))
        elif file_info["format"] == "excel":
            df = pd.read_excel(io.BytesIO(data))
        elif file_info["format"] == "json":
            df = pd.read_json(io.BytesIO(data), orient="records")
        else:
            raise HTTPException(
                status_code=400, detail=f"Format {file_info['format']} non supporté"
            )
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f"Erreur lors du chargement du fichier : {str(e)}"
        )

    # Appliquer le prétraitement
    try:
        preprocessing = params.preprocessing or Preprocessing()
        df_processed = preprocess_data(df, preprocessing, params.features)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Sélectionner le nombre optimal de clusters si demandé
    try:
        if params.auto_cluster_selection and params.algorithm in [
            "kmeans",
            "hierarchical",
        ]:
            if params.algorithm == "kmeans":
                if isinstance(params.parameters, KMeansParams):
                    params.parameters.n_clusters = select_optimal_clusters(
                        df_processed, params.algorithm, params.parameters
                    )
            elif params.algorithm == "hierarchical":
                if isinstance(params.parameters, HierarchicalParams):
                    params.parameters.n_clusters = select_optimal_clusters(
                        df_processed, params.algorithm, params.parameters
                    )

        # Appliquer le clustering
        if params.algorithm == "kmeans":
            include_params = {
                "n_clusters",
                "max_iter",
                "init",
                "n_init",
            }
            model = KMeans(
                **params.parameters.model_dump(include=include_params),
                random_state=42,
            )
        elif params.algorithm == "hierarchical":
            include_params = {
                "n_clusters",
                "linkage",
                "distance_threshold",
            }
            model = AgglomerativeClustering(
                **params.parameters.model_dump(include=include_params)
            )
        elif params.algorithm == "dbscan":
            include_params = {
                "eps",
                "min_samples",
                "metric",
            }
            model = DBSCAN(**params.parameters.model_dump(include=include_params))
        elif params.algorithm == "optics":
            include_params = {
                "min_samples",
                "xi",
                "metric",
            }
            model = OPTICS(**params.parameters.model_dump(include=include_params))
        else:
            raise ValueError(f"Algorithme {params.algorithm} non supporté")

        labels = model.fit_predict(df_processed)
        df["cluster"] = labels

        # Calculer les métriques
        metrics = compute_metrics(df_processed, labels, params.metrics, model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Générer le chemin de sortie
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    result_path = (
        f"dataworkspace/transformed/{user_id}/transformed_{timestamp}.xlsx"
        if params.output_format == "excel"
        else f"dataworkspace/transformed/{user_id}/transformed_{timestamp}.{params.output_format}"
    )

    # Sauvegarder le résultat
    output_data: bytes
    try:
        if params.output_format == "csv":
            output_data = df.to_csv(index=False).encode()
        elif params.output_format == "excel":
            with io.BytesIO() as buffer:
                df.to_excel(buffer, index=False, engine="openpyxl")
                output_data = buffer.getvalue()
        elif params.output_format == "json":
            output_data = df.to_json(orient="records", indent=2).encode()
        else:
            raise HTTPException(status_code=500, detail="Format de sortie invalide")
        minio_client.upload_file(result_path, output_data)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Erreur lors de l'enregistrement : {str(e)}"
        )

    # Construire les métadonnées
    result_metadata = {
        "rows": len(df),
        "cluster_count": len(set(labels)) - (1 if -1 in labels else 0),
        "algorithm": params.algorithm,
        "metrics": metrics,
    }

    return {"result_path": result_path, "metadata": result_metadata}
