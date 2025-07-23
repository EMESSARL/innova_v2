from typing import Any
from fastapi import APIRouter, HTTPException
import pandas as pd
import io
from pydantic import BaseModel, field_validator
from datetime import datetime, timezone, timedelta
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.svm import OneClassSVM
from sklearn.covariance import EllipticEnvelope
from sklearn.preprocessing import (
    StandardScaler,
    MinMaxScaler,
    RobustScaler,
    OneHotEncoder,
    LabelEncoder,
)
from sklearn.impute import SimpleImputer
from app.utils.minio_client import MinioClient

router = APIRouter()


class IsolationForestParams(BaseModel):
    """Hyperparamètres pour Isolation Forest."""

    n_estimators: int = 100
    contamination: float = 0.1
    max_samples: int | float | str = "auto"

    @field_validator("n_estimators")
    def validate_n_estimators(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("n_estimators doit être positif")
        return v

    @field_validator("contamination")
    def validate_contamination(cls, v: float) -> float:
        if not 0 < v <= 0.5:
            raise ValueError("contamination doit être dans ]0, 0.5]")
        return v


class LOFParams(BaseModel):
    """Hyperparamètres pour Local Outlier Factor."""

    n_neighbors: int = 20
    contamination: float = 0.1

    @field_validator("n_neighbors")
    def validate_n_neighbors(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("n_neighbors doit être positif")
        return v

    @field_validator("contamination")
    def validate_contamination(cls, v: float) -> float:
        if not 0 < v <= 0.5:
            raise ValueError("contamination doit être dans ]0, 0.5]")
        return v


class OneClassSVMParams(BaseModel):
    """Hyperparamètres pour One-Class SVM."""

    nu: float = 0.1
    kernel: str = "rbf"
    gamma: float | str = "scale"

    @field_validator("nu")
    def validate_nu(cls, v: float) -> float:
        if not 0 < v <= 1:
            raise ValueError("nu doit être dans ]0, 1]")
        return v

    @field_validator("kernel")
    def validate_kernel(cls, v: str) -> str:
        if v not in ["rbf", "linear"]:
            raise ValueError("kernel doit être 'rbf' ou 'linear'")
        return v

    @field_validator("gamma")
    def validate_gamma(cls, v: float | str) -> float | str:
        if isinstance(v, float) and v <= 0:
            raise ValueError("gamma doit être positif si numérique")
        if isinstance(v, str) and v not in ["scale", "auto"]:
            raise ValueError("gamma doit être 'scale' ou 'auto' si chaîne")
        return v


class EllipticEnvelopeParams(BaseModel):
    """Hyperparamètres pour Elliptic Envelope."""

    contamination: float = 0.1
    support_fraction: float = 1.0

    @field_validator("contamination")
    def validate_contamination(cls, v: float) -> float:
        if not 0 < v <= 0.5:
            raise ValueError("contamination doit être dans ]0, 0.5]")
        return v

    @field_validator("support_fraction")
    def validate_support_fraction(cls, v: float) -> float:
        if not 0 < v <= 1:
            raise ValueError("support_fraction doit être dans ]0, 1]")
        return v


class Preprocessing(BaseModel):
    """Paramètres de prétraitement des données."""

    scaling: str = "none"
    encoding: str = "none"
    imputation: str = "drop"

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


class DetectParameters(BaseModel):
    """Paramètres pour la détection d'anomalies."""

    state_id: int
    algorithm: str | None = None
    hyperparameters: (
        IsolationForestParams
        | LOFParams
        | OneClassSVMParams
        | EllipticEnvelopeParams
        | None
    ) = None
    preprocessing: Preprocessing | None = None
    auto_algorithm_selection: bool = False
    anomaly_threshold: float | None = None
    output_format: str

    @field_validator("algorithm")
    def validate_algorithm(cls, v: str | None) -> str | None:
        if v is not None and v not in [
            "isolation_forest",
            "lof",
            "one_class_svm",
            "elliptic_envelope",
        ]:
            raise ValueError(
                "algorithme doit être 'isolation_forest', 'lof', 'one_class_svm' ou 'elliptic_envelope'"
            )
        return v

    @field_validator("output_format")
    def validate_output_format(cls, v: str) -> str:
        if v not in ["csv", "excel", "json"]:
            raise ValueError("output_format doit être 'csv', 'excel' ou 'json'")
        return v

    @field_validator("anomaly_threshold")
    def validate_anomaly_threshold(cls, v: float | None) -> float | None:
        if v is not None and not 0 <= v <= 1:
            raise ValueError("anomaly_threshold doit être dans [0, 1]")
        return v


class RequestBody(BaseModel):
    """Corps de la requête pour la détection d'anomalies."""

    parameters: DetectParameters
    metadata: dict[str, Any]


def preprocess_data(df: pd.DataFrame, preprocessing: Preprocessing) -> pd.DataFrame:
    """
    Applique le prétraitement (imputation, encoding, scaling) au DataFrame.

    Args:
        df: DataFrame à prétraiter.
        preprocessing: Paramètres de prétraitement.

    Returns:
        DataFrame prétraité.

    Raises:
        ValueError: Si le prétraitement est invalide ou les types de colonnes sont incompatibles.
    """
    df_processed = df.copy()

    # Séparer les colonnes numériques et catégoriques
    numeric_cols = df.select_dtypes(include=["float64", "int64"]).columns
    categorical_cols = df.select_dtypes(include=["object", "category"]).columns

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

    return df_processed


def detect_anomalies_process(
    df: pd.DataFrame,
    algorithm: str | None,
    hyperparameters: (
        IsolationForestParams
        | LOFParams
        | OneClassSVMParams
        | EllipticEnvelopeParams
        | None
    ),
    threshold: float | None,
) -> tuple[pd.Series, pd.Series]:
    """
    Détecte les anomalies avec l'algorithme spécifié.

    Args:
        df: DataFrame à analyser.
        algorithm: Algorithme de détection.
        hyperparameters: Paramètres spécifiques à l'algorithme.
        threshold: Seuil pour classifier les anomalies.

    Returns:
        Tuple contenant les indicateurs d'anomalie (bool) et les scores.

    Raises:
        ValueError: Si l'algorithme ou les hyperparamètres sont invalides.
    """
    if df.select_dtypes(include=["float64", "int64"]).columns.empty:
        raise ValueError("Aucune colonne numérique détectée")

    hyperparams = hyperparameters.model_dump() if hyperparameters else {}
    if algorithm == "isolation_forest":
        model = IsolationForest(**hyperparams, random_state=42)
        model.fit(df)
        scores = model.decision_function(df)
        anomalies = model.predict(df) == -1
    elif algorithm == "lof":
        # Vérifier si n_neighbors est valide par rapport à la taille du DataFrame
        # Si n_neighbors est supérieur ou égal au nombre d'échantillons, LOF ne peut pas fonctionner correctement.
        if "n_neighbors" in hyperparams and hyperparams["n_neighbors"] >= len(df):
            raise ValueError(
                f"n_neighbors ({hyperparams['n_neighbors']}) doit être inférieur au nombre d'échantillons ({len(df)}) pour LOF."
            )
        model = LocalOutlierFactor(**hyperparams)
        anomalies = model.fit_predict(df) == -1
        scores = -model.negative_outlier_factor_
    elif algorithm == "one_class_svm":
        model = OneClassSVM(**hyperparams)
        model.fit(df)
        scores = model.decision_function(df)
        anomalies = model.predict(df) == -1
    elif algorithm == "elliptic_envelope":
        model = EllipticEnvelope(**hyperparams)
        model.fit(df)
        anomalies = model.predict(df) == -1
        scores = model.decision_function(df)
    else:
        raise ValueError(f"Algorithme {algorithm} non supporté")

    # Appliquer le seuil personnalisé
    if threshold is not None:
        anomalies = scores > threshold

    return pd.Series(anomalies), pd.Series(scores)


def select_best_algorithm(
    df: pd.DataFrame,
    hyperparameters: (
        IsolationForestParams
        | LOFParams
        | OneClassSVMParams
        | EllipticEnvelopeParams
        | None
    ),
) -> tuple[str, pd.Series, pd.Series]:
    """
    Sélectionne le meilleur algorithme en comparant le nombre d'anomalies détectées.

    Args:
        df: DataFrame à analyser.
        hyperparameters: Paramètres spécifiques.

    Returns:
        Tuple contenant le meilleur algorithme, les indicateurs d'anomalie et les scores.
    """
    algorithms = ["isolation_forest", "lof", "one_class_svm", "elliptic_envelope"]
    best_algorithm = None
    best_anomalies = None
    best_scores = None
    max_anomalies = -1

    for algo in algorithms:
        try:
            # Utiliser les hyperparamètres par défaut si non fournis
            algo_hyperparams = (
                hyperparameters
                if hyperparameters
                and algo
                == hyperparameters.__class__.__name__.lower().replace("params", "")
                else None
            )
            anomalies, scores = detect_anomalies_process(
                df, algo, algo_hyperparams, None
            )
            anomaly_count = anomalies.sum()
            if anomaly_count > max_anomalies:
                max_anomalies = anomaly_count
                best_algorithm = algo
                best_anomalies = anomalies
                best_scores = scores
        except Exception:
            continue

    if best_algorithm is None:
        raise ValueError("Aucun algorithme n'a pu être appliqué")
    # Assurer que les types sont corrects pour Pylance
    # assert best_anomalies is not None
    # assert best_scores is not None
    if best_anomalies is None or best_scores is None:
        raise ValueError("Aucun algorithme n'a pu détecter des anomalies")
    return best_algorithm, best_anomalies, best_scores


@router.post("/")
async def detect_anomalies(body: RequestBody) -> dict[str, Any]:
    """
    Détecte les anomalies dans un dataset en utilisant un algorithme d'apprentissage automatique.

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
        (f for f in metadata["files"] if f["state_id"] == params.state_id), None
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
        df_processed = preprocess_data(df, preprocessing)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Sélectionner les colonnes numériques pour la détection
    numeric_cols = df_processed.select_dtypes(include=["float64", "int64"]).columns
    if numeric_cols.empty:
        raise HTTPException(
            status_code=400,
            detail="Aucune colonne numérique détectée après prétraitement",
        )
    X = df_processed[numeric_cols]

    # Détecter les anomalies
    try:
        if params.auto_algorithm_selection:
            algorithm, anomalies, scores = select_best_algorithm(
                X, params.hyperparameters
            )
        else:
            algorithm = params.algorithm
            anomalies, scores = detect_anomalies_process(
                X, algorithm, params.hyperparameters, params.anomaly_threshold
            )

        # Ajouter les colonnes is_anomaly et anomaly_score
        df["is_anomaly"] = anomalies
        df["anomaly_score"] = scores
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Générer le chemin de sortie
    version = metadata.get("version") + 1
    source_id = metadata.get("source_id")
    gmt_plus_1 = timezone(timedelta(hours=1))
    timestamp = datetime.now(gmt_plus_1).strftime("%Y%m%d_%H%M%S")
    result_path = (
        f"dataworkspace/processingstates/{user_id}/source_{source_id}_state_{params.state_id}_processing_v{version}_{timestamp}.xlsx"
        if params.output_format == "excel"
        else f"dataworkspace/processingstates/{user_id}/source_{source_id}_state_{params.state_id}_processing_v{version}_{timestamp}.{params.output_format}"
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
        "anomaly_count": int(anomalies.sum()),
        "algorithm": algorithm,
        "columns": list(df.columns)
    }

    return {"result_path": result_path, "metadata": result_metadata}
