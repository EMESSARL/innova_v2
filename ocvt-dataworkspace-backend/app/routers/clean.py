from typing import Any
from fastapi import APIRouter, HTTPException
import pandas as pd
import io
import numpy as np
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
from app.utils.minio_client import MinioClient

router = APIRouter()


class RemoveDuplicates(BaseModel):
    """Paramètres pour la suppression des doublons."""

    columns: list[str]
    action: str
    condition: dict[str, str] | None = None


class HandleMissing(BaseModel):
    """Paramètres pour la gestion des valeurs manquantes."""

    action: str
    value: str | float | int | bool | None = None


class TextCleaning(BaseModel):
    """Paramètres pour le nettoyage de texte."""

    operations: list[str]


class Transformation(BaseModel):
    """Paramètres pour les transformations de colonnes."""

    action: str
    base: float | None = None


class OutlierHandling(BaseModel):
    """Paramètres pour la gestion des outliers."""

    method: str
    action: str
    threshold: float | None = None


class CleaningActions(BaseModel):
    """Actions de nettoyage à appliquer."""

    remove_duplicates: RemoveDuplicates | None = None
    handle_missing: dict[str, HandleMissing] | None = None
    text_cleaning: dict[str, TextCleaning] | None = None
    transformations: dict[str, Transformation] | None = None
    outlier_handling: dict[str, OutlierHandling] | None = None


class CleanParameters(BaseModel):
    """Paramètres pour le nettoyage du dataset."""

    dataset_id: int
    cleaning_actions: CleaningActions
    keep_original: bool = True
    output_format: str


class RequestBody(BaseModel):
    """Corps de la requête pour le nettoyage."""

    parameters: CleanParameters
    metadata: dict[str, Any]


@router.post("/")
async def clean_dataset(body: RequestBody) -> dict[str, Any]:
    """
    Nettoie un dataset en appliquant des actions comme suppression des doublons, gestion des valeurs manquantes, etc.

    Args:
        body: Corps de la requête contenant les paramètres et métadonnées.

    Returns:
        Dictionnaire avec le chemin du résultat dans MinIO et les métadonnées.

    Raises:
        HTTPException: Si le fichier est introuvable, le format est invalide ou les actions sont incorrectes.
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

    cleaning_summary = {
        "duplicates_removed": 0,
        "missing_handled": {},
        "outliers_handled": {},
        "transformations_applied": [],
        "text_cleaning_applied": [],
    }

    # Suppression des doublons
    if params.cleaning_actions.remove_duplicates:
        action = params.cleaning_actions.remove_duplicates
        if action.columns and not all(col in df.columns for col in action.columns):
            raise HTTPException(
                status_code=400, detail="Colonnes pour doublons introuvables"
            )
        if action.action not in ["keep_first", "keep_last", "drop"]:
            raise HTTPException(
                status_code=400,
                detail="Action de doublons invalide",
            )
        initial_rows = len(df)
        if action.condition and "column" in action.condition:
            if action.condition["column"] not in df.columns:
                raise HTTPException(
                    status_code=400,
                    detail="Colonne de condition introuvable",
                )
            df = df.sort_values(
                action.condition["column"],
                ascending=action.condition["keep"] == "earliest",
            )
        if action.action != "drop":
            df = df.drop_duplicates(
                subset=action.columns,
                keep="first" if action.action == "keep_first" else "last",
            )
        else:
            df = df.drop_duplicates(subset=action.columns, keep=False)
        cleaning_summary["duplicates_removed"] = initial_rows - len(df)

    # Gestion des valeurs manquantes
    if params.cleaning_actions.handle_missing:
        for col, action in params.cleaning_actions.handle_missing.items():
            if col not in df.columns:
                raise HTTPException(
                    status_code=400, detail=f"Colonne {col} introuvable"
                )
            if action.action not in [
                "drop",
                "mean",
                "median",
                "mode",
                "custom",
            ]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Action {action.action} invalide",
                )
            missing_count = df[col].isna().sum()
            if action.action == "drop":
                df = df.dropna(subset=[col])
            elif action.action in ["mean", "median"] and pd.api.types.is_numeric_dtype(
                df[col]
            ):
                df[col] = df[col].fillna(
                    df[col].mean() if action.action == "mean" else df[col].median()
                )
            elif action.action == "mode":
                df[col] = df[col].fillna(
                    df[col].mode()[0] if not df[col].mode().empty else None
                )
            elif action.action == "custom":
                if action.value is None:
                    raise HTTPException(
                        status_code=400,
                        detail="Valeur personnalisée requise pour 'custom'",
                    )
                df[col] = df[col].fillna(action.value)
            cleaning_summary["missing_handled"][col] = int(missing_count)

    # Nettoyage de texte
    if params.cleaning_actions.text_cleaning:
        for col, cleaning in params.cleaning_actions.text_cleaning.items():
            if col not in df.columns:
                raise HTTPException(
                    status_code=400, detail=f"Colonne {col} introuvable"
                )
            if not pd.api.types.is_string_dtype(df[col]):
                raise HTTPException(
                    status_code=400, detail=f"Colonne {col} doit être textuelle"
                )
            for op in cleaning.operations:
                if op not in ["trim", "to_lower", "to_upper", "remove_special_chars"]:
                    raise HTTPException(
                        status_code=400, detail=f"Opération {op} invalide"
                    )
                if op == "trim":
                    df[col] = df[col].str.strip()
                elif op == "to_lower":
                    df[col] = df[col].str.lower()
                elif op == "to_upper":
                    df[col] = df[col].str.upper()
                elif op == "remove_special_chars":
                    df[col] = df[col].str.replace(r"[^\w\s]", "", regex=True)
                cleaning_summary["text_cleaning_applied"].append(f"{col}:{op}")

    # Gestion des outliers
    if params.cleaning_actions.outlier_handling:
        for col, handling in params.cleaning_actions.outlier_handling.items():
            if col not in df.columns:
                raise HTTPException(
                    status_code=400, detail=f"Colonne {col} introuvable"
                )
            if not pd.api.types.is_numeric_dtype(df[col]):
                raise HTTPException(
                    status_code=400, detail=f"Colonne {col} doit être numérique"
                )
            if handling.method not in ["IQR", "z-score"]:
                raise HTTPException(
                    status_code=400, detail=f"Méthode {handling.method} invalide"
                )
            if handling.action not in ["clip", "drop"]:
                raise HTTPException(
                    status_code=400, detail=f"Action {handling.action} invalide"
                )
            outliers = 0
            if handling.method == "IQR":
                Q1 = df[col].quantile(0.25)
                Q3 = df[col].quantile(0.75)
                IQR = Q3 - Q1
                lower_bound = Q1 - 1.5 * IQR
                upper_bound = Q3 + 1.5 * IQR
                outliers = ((df[col] < lower_bound) | (df[col] > upper_bound)).sum()
                if handling.action == "clip":
                    df[col] = df[col].clip(lower=lower_bound, upper=upper_bound)
                else:
                    df = df[(df[col] >= lower_bound) & (df[col] <= upper_bound)]
            elif handling.method == "z-score":
                threshold = handling.threshold or 3
                std = df[col].std()
                if std == 0:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Écart-type nul pour la colonne {col}, impossible de calculer le z-score",
                    )
                z_scores = np.abs((df[col] - df[col].mean()) / std)
                outliers = (z_scores > threshold).sum()
                if handling.action == "clip":
                    mean = df[col].mean()
                    df[col] = df[col].clip(
                        lower=mean - threshold * std, upper=mean + threshold * std
                    )
                else:
                    df = df[z_scores <= threshold]
            cleaning_summary["outliers_handled"][col] = int(outliers)

    # Transformations
    if params.cleaning_actions.transformations:
        for col, transform in params.cleaning_actions.transformations.items():
            if col not in df.columns:
                raise HTTPException(
                    status_code=400, detail=f"Colonne {col} introuvable"
                )
            new_col = f"{col}_transformed" if params.keep_original else col
            if transform.action not in [
                "to_int",
                "to_float",
                "to_string",
                "log",
                "to_date",
            ]:
                raise HTTPException(
                    status_code=400, detail=f"Action {transform.action} invalide"
                )
            if transform.action == "to_int":
                df[new_col] = pd.to_numeric(df[col], errors="coerce").apply(int)
            elif transform.action == "to_float":
                df[new_col] = pd.to_numeric(df[col], errors="coerce").apply(float)
            elif transform.action == "to_string":
                df[new_col] = df[col].astype(str)
            elif transform.action == "to_date":
                try:
                    df[new_col] = pd.to_datetime(df[col], errors="coerce")
                except Exception as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Erreur lors de la conversion en date pour la colonne {col}: {str(e)}",
                    )
            elif transform.action == "log":
                if not pd.api.types.is_numeric_dtype(df[col]) or (df[col] <= 0).any():
                    raise HTTPException(
                        status_code=400,
                        detail=f"Colonne {col} doit être numérique et positive pour log",
                    )
                df[new_col] = (
                    np.log(df[col])
                    if transform.base is None
                    else np.log(df[col]) / np.log(transform.base)
                )
            cleaning_summary["transformations_applied"].append(
                f"{col}:{transform.action}"
            )

    # df = df.reset_index(drop=True)

    # Générer le chemin de sortie
    gmt_plus_1 = timezone(timedelta(hours=1))
    timestamp = datetime.now(gmt_plus_1).strftime("%Y%m%d_%H%M%S")
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
            raise HTTPException(status_code=400, detail="Format de sortie invalide")
        minio_client.upload_file(result_path, output_data)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Erreur lors de l'enregistrement : {str(e)}"
        )

    # Construire les métadonnées
    result_metadata = {
        "rows": len(df),
        "columns": list(df.columns),
        "cleaning_summary": cleaning_summary,
    }

    return {"result_path": result_path, "metadata": result_metadata}
