from typing import Any
from fastapi import APIRouter, HTTPException
import pandas as pd
import io
from pydantic import BaseModel, field_validator
from datetime import datetime
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from xgboost import XGBRegressor, XGBClassifier
from sklearn.preprocessing import (
    StandardScaler,
    MinMaxScaler,
    OneHotEncoder,
    LabelEncoder,
)
from sklearn.impute import SimpleImputer
from sklearn.model_selection import cross_val_score
import numpy as np
from app.utils.minio_client import MinioClient

router = APIRouter()


class LinearRegressionParams(BaseModel):
    """Hyperparamètres pour Linear Regression."""

    fit_intercept: bool = True
    normalize: bool = False


class LogisticRegressionParams(BaseModel):
    """Hyperparamètres pour Logistic Regression."""

    C: float = 1.0
    max_iter: int = 100

    @field_validator("C")
    def validate_C(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("C doit être positif")
        return v

    @field_validator("max_iter")
    def validate_max_iter(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("max_iter doit être positif")
        return v


class RandomForestParams(BaseModel):
    """Hyperparamètres pour Random Forest."""

    n_estimators: int = 100
    max_depth: int | None = None
    min_samples_split: int = 2

    @field_validator("n_estimators")
    def validate_n_estimators(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("n_estimators doit être positif")
        return v

    @field_validator("max_depth")
    def validate_max_depth(cls, v: int | None) -> int | None:
        if v is not None and v <= 0:
            raise ValueError("max_depth doit être positif")
        return v

    @field_validator("min_samples_split")
    def validate_min_samples_split(cls, v: int) -> int:
        if v < 2:
            raise ValueError("min_samples_split doit être >= 2")
        return v


class XGBoostParams(BaseModel):
    """Hyperparamètres pour XGBoost."""

    n_estimators: int = 100
    learning_rate: float = 0.1
    max_depth: int = 3
    subsample: float = 1.0
    colsample_bytree: float = 1.0

    @field_validator("n_estimators")
    def validate_n_estimators(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("n_estimators doit être positif")
        return v

    @field_validator("learning_rate")
    def validate_learning_rate(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("learning_rate doit être positif")
        return v

    @field_validator("max_depth")
    def validate_max_depth(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("max_depth doit être positif")
        return v

    @field_validator("subsample")
    def validate_subsample(cls, v: float) -> float:
        if not (0 < v <= 1):
            raise ValueError("subsample doit être entre 0 et 1")
        return v

    @field_validator("colsample_bytree")
    def validate_colsample_bytree(cls, v: float) -> float:
        if not (0 < v <= 1):
            raise ValueError("colsample_bytree doit être entre 0 et 1")
        return v


class Preprocessing(BaseModel):
    """Paramètres de prétraitement des données."""

    scaling: str = "none"
    encoding: str = "none"
    imputation: str = "drop"

    @field_validator("scaling")
    def validate_scaling(cls, v: str) -> str:
        if v not in ["none", "standard", "minmax"]:
            raise ValueError("scaling doit être 'none', 'standard' ou 'minmax'")
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


class PredictParameters(BaseModel):
    """Paramètres pour les prédictions."""

    dataset_id: int
    target_column: str
    prediction_type: str
    model: str | None = None
    hyperparameters: (
        LinearRegressionParams
        | LogisticRegressionParams
        | RandomForestParams
        | XGBoostParams
        | None
    ) = None
    preprocessing: Preprocessing | None = None
    auto_model_selection: bool = False
    confidence: bool = False
    output_format: str

    @field_validator("prediction_type")
    def validate_prediction_type(cls, v: str) -> str:
        if v not in ["regression", "classification"]:
            raise ValueError(
                "prediction_type doit être 'regression' ou 'classification'"
            )
        return v

    @field_validator("model")
    def validate_model(cls, v: str) -> str:
        if v not in [
            "linear_regression",
            "logistic_regression",
            "random_forest",
            "xgboost",
        ]:
            raise ValueError(
                "model doit être 'linear_regression', 'logistic_regression', 'random_forest' ou 'xgboost'"
            )
        return v

    @field_validator("output_format")
    def validate_output_format(cls, v: str) -> str:
        if v not in ["csv", "excel", "json"]:
            raise ValueError("output_format doit être 'csv', 'excel' ou 'json'")
        return v


class RequestBody(BaseModel):
    """Corps de la requête pour les prédictions."""

    parameters: PredictParameters
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
        scaler = {"standard": StandardScaler(), "minmax": MinMaxScaler()}[
            preprocessing.scaling
        ]
        df_processed[numeric_cols] = scaler.fit_transform(df_processed[numeric_cols])

    return df_processed


def select_best_model(
    X: pd.DataFrame, y: pd.Series, prediction_type: str
) -> tuple[str, dict[str, Any]]:
    """
    Sélectionne le meilleur modèle via validation croisée.

    Args:
        X: Caractéristiques.
        y: Variable cible.
        prediction_type: Type de prédiction ("regression" ou "classification").

    Returns:
        Tuple contenant le meilleur modèle et ses hyperparamètres.
    """
    models = {
        "regression": [
            (LinearRegression, LinearRegressionParams()),
            (RandomForestRegressor, RandomForestParams()),
            (XGBRegressor, XGBoostParams()),
        ],
        "classification": [
            (LogisticRegression, LogisticRegressionParams()),
            (RandomForestClassifier, RandomForestParams()),
            (XGBClassifier, XGBoostParams()),
        ],
    }
    scoring = (
        "neg_mean_squared_error" if prediction_type == "regression" else "accuracy"
    )
    best_model_name = None
    best_score = -float("inf")
    best_hyperparams = {}
    for model_cls, params in models[prediction_type]:
        try:
            model_instance = model_cls(**params.model_dump())
            scores = cross_val_score(model_instance, X, y, cv=5, scoring=scoring)
            mean_score = scores.mean()
            if mean_score > best_score:
                best_score = mean_score
                best_model_name = model_cls.__name__.lower()
                best_hyperparams = params.model_dump()
        except Exception:
            continue

    if best_model_name is None:
        raise ValueError("Aucun modèle n'a pu être ajusté")
    model_name_map = {
        "linearregression": "linear_regression",
        "logisticregression": "logistic_regression",
        "randomforestregressor": "random_forest",
        "randomforestclassifier": "random_forest",
        "xgbregressor": "xgboost",
        "xgbclassifier": "xgboost",
    }
    best_model_name = model_name_map.get(best_model_name, best_model_name)
    if not isinstance(best_model_name, str):
        raise ValueError("Le nom du modèle doit être une chaîne de caractères")
    return best_model_name, best_hyperparams


def compute_confidence(
    X: pd.DataFrame, model: Any, predictions: np.ndarray, prediction_type: str
) -> list[dict[str, float]]:
    """
    Calcule les intervalles de confiance (régression) ou probabilités (classification).

    Args:
        X: Données caractéristiques.
        model: Modèle entraîné.
        predictions: Prédictions.
        prediction_type: Type de prédiction.

    Returns:
        Liste des intervalles de confiance ou probabilités.
    """
    confidence_results = []
    if prediction_type == "regression":
        # Intervalle de confiance basé sur la variance des prédictions
        if hasattr(model, "predict_proba"):
            raise NotImplementedError(
                "Confidence intervals not supported for this model"
            )
        # Approximation simple : ±1.96 * std des prédictions
        std_error = np.std(predictions)
        for pred in predictions:
            confidence_results.append(
                {
                    "lower": float(pred - 1.96 * std_error),
                    "upper": float(pred + 1.96 * std_error),
                }
            )
    else:  # classification
        if hasattr(model, "predict_proba"):
            probs = model.predict_proba(X)
            for i, prob in enumerate(probs):
                confidence_results.append(
                    {f"prob_class_{j}": float(p) for j, p in enumerate(prob)}
                )
        else:
            confidence_results = [{} for _ in predictions]
    return confidence_results


@router.post("/")
async def predict(body: RequestBody) -> dict[str, Any]:
    """
    Effectue des prédictions sur un dataset en utilisant un modèle d'apprentissage automatique.

    Args:
        body: Corps de la requête avec paramètres et métadonnées.

    Returns:
        Dictionnaire avec le chemin du résultat dans MinIO et les métadonnées.

    Raises:
        HTTPException: Si le fichier est introuvable, le modèle est invalide ou les données sont incompatibles.
    """
    minio_client = MinioClient()
    params = body.parameters
    metadata = body.metadata
    user_id = metadata["user_id"]

    # Vérifier l’accès au fichier
    file_info = next(
        (f for f in metadata["files"] if f["dataset_id"] == params.dataset_id), None
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

    # Vérifier la colonne cible
    target_column = params.target_column
    if target_column not in df.columns:
        raise HTTPException(
            status_code=400, detail=f"Colonne cible '{target_column}' manquante"
        )
    y = df[target_column]
    X = df.drop(columns=[target_column])

    # Appliquer le prétraitement
    try:
        preprocessing = params.preprocessing or Preprocessing()
        X_processed = preprocess_data(X, preprocessing)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Sélectionner le modèle
    try:
        if params.auto_model_selection:
            model_name, hyperparams = select_best_model(
                X_processed, y, params.prediction_type
            )
        else:
            model_name = params.model
            hyperparams = (
                params.hyperparameters.model_dump() if params.hyperparameters else {}
            )

        # Valider la compatibilité modèle/type de prédiction
        regression_models = ["linear_regression", "random_forest", "xgboost"]
        classification_models = ["logistic_regression", "random_forest", "xgboost"]
        if (
            params.prediction_type == "regression"
            and model_name not in regression_models
        ):
            raise ValueError(f"Modèle {model_name} non compatible avec regression")
        if (
            params.prediction_type == "classification"
            and model_name not in classification_models
        ):
            raise ValueError(f"Modèle {model_name} non compatible avec classification")

        # Initialiser le modèle
        model = None
        if model_name == "linear_regression":
            model = LinearRegression(**hyperparams)
        elif model_name == "logistic_regression":
            model = LogisticRegression(**hyperparams)
        elif model_name == "random_forest":
            model = (
                RandomForestRegressor
                if params.prediction_type == "regression"
                else RandomForestClassifier
            )(**hyperparams)
        elif model_name == "xgboost":
            model = (
                XGBRegressor
                if params.prediction_type == "regression"
                else XGBClassifier
            )(**hyperparams)

        if model is None:
            raise ValueError(f"Modèle {model_name} non supporté ou non initialisé.")

        # Encoder la variable cible si c'est une classification et que le modèle est XGBoost
        y_encoded = y
        label_encoder = None  # Initialiser label_encoder
        if params.prediction_type == "classification" and model_name == "xgboost":
            label_encoder = LabelEncoder()
            y_encoded = label_encoder.fit_transform(y)

        # Entraîner et prédire
        model.fit(X_processed, y_encoded)
        predictions = model.predict(X_processed)

        # Décoder les prédictions si la cible a été encodée
        if (
            params.prediction_type == "classification"
            and model_name == "xgboost"
            and label_encoder
        ):
            predictions = label_encoder.inverse_transform(predictions)

        df["predicted_value"] = (
            predictions.tolist()
            if params.prediction_type == "regression"
            else predictions.tolist()
        )

        # Calculer la confiance si demandé
        confidence_results = []
        if params.confidence:
            confidence_results = compute_confidence(
                X_processed, model, predictions, params.prediction_type
            )
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
        "columns": list(df.columns),
        "model": model_name,
        "prediction_type": params.prediction_type,
        "confidence": confidence_results if params.confidence else None,
    }
    # Convertir les valeurs numpy en types Python natifs pour la sérialisation
    for key, value in result_metadata.items():
        if isinstance(value, np.ndarray):
            result_metadata[key] = value.tolist()
        elif isinstance(value, np.floating):
            result_metadata[key] = float(value)
        elif isinstance(value, np.integer):
            result_metadata[key] = int(value)

    return {"result_path": result_path, "metadata": result_metadata}
