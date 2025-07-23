from typing import Any
from fastapi import APIRouter, HTTPException
import pandas as pd
import io
import re
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
from app.utils.minio_client import MinioClient

router = APIRouter()


class Condition(BaseModel):
    """Condition de filtrage ou clause having."""

    column: str
    operator: str
    value: str | float | int | bool | list | None
    logical_operator: str | None = None


class NestedConditions(BaseModel):
    """Conditions imbriquées pour le filtrage."""

    logical_operator: str
    conditions: list["NestedConditions | Condition"]


class Aggregation(BaseModel):
    """Opération d'agrégation sur une colonne."""

    column: str
    functions: list[str]
    condition: Condition | None = None


class Having(BaseModel):
    """Clause having pour filtrer les agrégations."""

    column: str
    operator: str
    value: str | float | int


class ProcessParameters(BaseModel):
    """Paramètres pour le traitement du dataset."""

    state_id: int
    operation: str
    conditions: list[Condition] | None = None
    nested_conditions: NestedConditions | None = None
    group_by: list[str] | None = None
    aggregations: list[Aggregation] | None = None
    having: Having | None = None
    output_format: str


class RequestBody(BaseModel):
    """Corps de la requête pour le traitement."""

    parameters: ProcessParameters
    metadata: dict[str, Any]


def evaluate_condition(df: pd.DataFrame, condition: Condition) -> pd.Series:
    """
    Évalue une condition de filtrage sur un DataFrame.

    Args:
        df: DataFrame à filtrer.
        condition: Condition à évaluer.

    Returns:
        Série booléenne représentant le masque de filtrage.

    Raises:
        ValueError: Si l'opérateur ou la valeur est invalide.
    """
    if condition.column not in df.columns:
        raise ValueError(f"Colonne {condition.column} introuvable")
    if condition.operator not in [
        "=",
        "!=",
        ">",
        "<",
        ">=",
        "<=",
        "is_null",
        "is_not_null",
        "regex",
        "between",
    ]:
        raise ValueError(f"Opérateur {condition.operator} non supporté")

    if condition.operator == "is_null":
        return df[condition.column].isna()
    elif condition.operator == "is_not_null":
        return ~df[condition.column].isna()
    elif condition.operator == "regex":
        if not isinstance(condition.value, str) or not pd.api.types.is_string_dtype(
            df[condition.column]
        ):
            raise ValueError(
                "L'opérateur 'regex' nécessite une valeur chaîne et une colonne textuelle"
            )
        return df[condition.column].str.match(condition.value, na=False)
    elif condition.operator == "between":
        if not isinstance(condition.value, list) or len(condition.value) != 2:
            raise ValueError(
                "L'opérateur 'between' nécessite une liste de deux valeurs"
            )
        return (df[condition.column] >= condition.value[0]) & (
            df[condition.column] <= condition.value[1]
        )
    else:
        try:
            if condition.operator == "=":
                return df[condition.column] == condition.value
            elif condition.operator == "!=":
                return df[condition.column] != condition.value
            elif condition.operator == ">":
                return df[condition.column] > condition.value
            elif condition.operator == "<":
                return df[condition.column] < condition.value
            elif condition.operator == ">=":
                return df[condition.column] >= condition.value
            elif condition.operator == "<=":
                return df[condition.column] <= condition.value
        except TypeError:
            raise ValueError(
                f"Type incompatible pour {condition.column} avec {condition.operator}"
            )

        # Default return in case no condition matches
        raise ValueError("Aucune condition valide n'a été évaluée")


def evaluate_nested_conditions(df: pd.DataFrame, nested: NestedConditions) -> pd.Series:
    """
    Évalue des conditions imbriquées récursivement.

    Args:
        df: DataFrame à filtrer.
        nested: Structure de conditions imbriquées.

    Returns:
        Série booléenne représentant le masque combiné.

    Raises:
        ValueError: Si l'opérateur logique ou les conditions sont invalides.
    """
    if nested.logical_operator not in ["AND", "OR"]:
        raise ValueError(f"Opérateur logique {nested.logical_operator} non supporté")

    mask = None
    for cond in nested.conditions:
        sub_mask = (
            evaluate_nested_conditions(df, cond)
            if isinstance(cond, NestedConditions)
            else evaluate_condition(df, cond)
        )
        if mask is None:
            mask = sub_mask
        else:
            mask = (
                mask & sub_mask if nested.logical_operator == "AND" else mask | sub_mask
            )
    if mask is None:
        raise ValueError(
            "Aucune condition valide n'a été trouvée pour évaluer le masque"
        )
    return mask


@router.post("/")
async def process_data(body: RequestBody) -> dict[str, Any]:
    """
    Filtre ou agrège un dataset selon les conditions ou regroupements spécifiés.

    Args:
        body: Corps de la requête contenant les paramètres et métadonnées.

    Returns:
        Dictionnaire avec le chemin du résultat dans MinIO et les métadonnées.

    Raises:
        HTTPException: Si le fichier est introuvable, le format est invalide ou les paramètres sont incorrects.
    """
    minio_client = MinioClient()
    params = body.parameters
    metadata = body.metadata
    user_id = metadata["user_id"]

    # Vérifier l'accès au fichier
    file_info = next(
        (f for f in metadata["files"] if f["state_id"] == params.state_id),
        None,
    )
    if not file_info:  # or not file_info["path"].startswith(f"datasets/{user_id}/"):
        raise HTTPException(status_code=403, detail="Accès non autorisé au fichier")

    # Valider l'opération
    if params.operation not in ["filter", "aggregate"]:
        raise HTTPException(
            status_code=400, detail=f"Opération {params.operation} non supportée"
        )

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

    processing_summary = {
        "filtered_rows": 0,
        "group_by_columns": [],
        "aggregations_applied": [],
    }

    # Traitement pour l'opération "filter"
    if params.operation == "filter":
        df_nested = df.copy()  # Pour conserver le DataFrame original
        if not params.conditions and not params.nested_conditions:
            raise HTTPException(
                status_code=400,
                detail="Conditions ou nested_conditions requis pour le filtrage",
            )

        initial_rows = len(df)
        try:
            # Appliquer les conditions simples
            if params.conditions:
                mask = None
                for i, cond in enumerate(params.conditions):
                    sub_mask = evaluate_condition(df, cond)
                    if i == 0:
                        mask = sub_mask
                    else:
                        logical_op = params.conditions[i - 1].logical_operator or "AND"
                        if logical_op not in ["AND", "OR"]:
                            raise HTTPException(
                                status_code=400,
                                detail=f"Opérateur logique {logical_op} non supporté",
                            )
                        mask = (
                            (mask & sub_mask)
                            if (
                                mask is not None
                                and sub_mask is not None
                                and logical_op == "AND"
                            )
                            else (
                                mask | sub_mask
                                if mask is not None and sub_mask is not None
                                else sub_mask
                            )
                        )
                df = df[mask] if mask is not None else df

            # Appliquer les conditions imbriquées
            if params.nested_conditions:
                mask = evaluate_nested_conditions(df_nested, params.nested_conditions)
                df_nested = df_nested[mask]
            df = pd.concat([df, df_nested], ignore_index=True)

            processing_summary["filtered_rows"] = initial_rows - len(df)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # Traitement pour l'opération "aggregate"
    elif params.operation == "aggregate":
        if not params.group_by or not params.aggregations:
            raise HTTPException(
                status_code=400,
                detail="group_by et aggregations requis pour l'agrégation",
            )

        # Valider les colonnes de regroupement
        for col in params.group_by:
            if col not in df.columns and not re.match(
                r".+\(.+\)", col
            ):  # Exclure year(date) pour validation
                raise HTTPException(
                    status_code=400, detail=f"Colonne de regroupement {col} introuvable"
                )

        # Valider les agrégations
        agg_funcs = {
            "sum": "sum",
            "avg": "mean",
            "min": "min",
            "max": "max",
            "count": "count",
            "std": "std",
        }
        for agg in params.aggregations:
            if agg.column not in df.columns:
                raise HTTPException(
                    status_code=400, detail=f"Colonne {agg.column} introuvable"
                )
            if not all(f in agg_funcs for f in agg.functions):
                raise HTTPException(
                    status_code=400, detail=f"Fonctions {agg.functions} non supportées"
                )
            if "std" in agg.functions and not pd.api.types.is_numeric_dtype(
                df[agg.column]
            ):
                raise HTTPException(
                    status_code=400,
                    detail=f"La fonction 'std' nécessite une colonne numérique",
                )

        # Appliquer les conditions d'agrégation
        df_agg = df.copy()
        for agg in params.aggregations:
            if agg.condition:
                try:
                    mask = evaluate_condition(df_agg, agg.condition)
                    df_agg = df_agg[mask]
                except ValueError as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Condition d'agrégation invalide : {str(e)}",
                    )

        # Construire les agrégations
        try:
            agg_dict = {}
            for agg in params.aggregations:
                for func in agg.functions:
                    agg_dict[f"{agg.column}_{func}"] = (agg.column, agg_funcs[func])
            grouped = df_agg.groupby(params.group_by).agg(**agg_dict).reset_index()

            # Appliquer la clause having
            if params.having:
                if params.having.column not in grouped.columns:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Colonne having {params.having.column} introuvable",
                    )
                if params.having.operator not in ["=", "!=", ">", "<", ">=", "<="]:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Opérateur having {params.having.operator} non supporté",
                    )
                try:
                    if params.having.operator == "=":
                        grouped = grouped[
                            grouped[params.having.column] == params.having.value
                        ]
                    elif params.having.operator == "!=":
                        grouped = grouped[
                            grouped[params.having.column] != params.having.value
                        ]
                    elif params.having.operator == ">":
                        grouped = grouped[
                            grouped[params.having.column] > params.having.value
                        ]
                    elif params.having.operator == "<":
                        grouped = grouped[
                            grouped[params.having.column] < params.having.value
                        ]
                    elif params.having.operator == ">=":
                        grouped = grouped[
                            grouped[params.having.column] >= params.having.value
                        ]
                    elif params.having.operator == "<=":
                        grouped = grouped[
                            grouped[params.having.column] <= params.having.value
                        ]
                except TypeError:
                    raise HTTPException(
                        status_code=400,
                        detail="Type incompatible pour la clause having",
                    )

            df = grouped
            processing_summary["group_by_columns"] = params.group_by
            processing_summary["aggregations_applied"] = [
                f"{func}:{agg.column}"
                for agg in params.aggregations
                for func in agg.functions
            ]
        except Exception as e:
            raise HTTPException(
                status_code=400, detail=f"Erreur lors de l'agrégation : {str(e)}"
            )

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
        "filtered_rows" if params.operation == "filter" else "group_by_columns": (
            processing_summary["filtered_rows"]
            if params.operation == "filter"
            else processing_summary["group_by_columns"]
        ),
        "aggregations_applied" if params.operation == "aggregate" else None: (
            processing_summary["aggregations_applied"]
            if params.operation == "aggregate"
            else None
        ),
    }

    return {"result_path": result_path, "metadata": result_metadata}
