from typing import Any
from fastapi import APIRouter, HTTPException
import pandas as pd
import io
from pydantic import BaseModel
from datetime import datetime
from app.utils.minio_client import MinioClient

router = APIRouter()


class Dataset(BaseModel):
    """Représente un dataset à fusionner."""

    dataset_id: int
    path: str | None = None


class MergeParameters(BaseModel):
    """Paramètres pour la fusion de datasets."""

    datasets: list[Dataset]
    key_mappings: dict[int, str]
    merge_type: str
    output_format: str
    duplicate_handling: str | None = None
    suffixes: list[str] | None = None


class RequestBody(BaseModel):
    """Corps de la requête pour la fusion."""

    parameters: MergeParameters
    metadata: dict[str, Any]


@router.post("/")
async def merge_datasets(body: RequestBody) -> dict[str, Any]:
    """
    Fusionne plusieurs datasets avec une clé commune.

    Args:
        body: Corps de la requête contenant les paramètres et métadonnées.

    Returns:
        Dictionnaire avec le chemin du résultat dans MinIO et les métadonnées.

    Raises:
        HTTPException: Si les fichiers sont introuvables, les clés sont incompatibles, ou le format est invalide.
    """
    minio_client = MinioClient()
    params = body.parameters
    metadata = body.metadata
    user_id = metadata["user_id"]

    # Vérifier l'accès aux fichiers
    # for file in metadata["files"]:
    #     if not file["path"].startswith(f"dataworkspace/datasets/{user_id}/"):
    #         raise HTTPException(status_code=403, detail="Accès non autorisé au fichier")

    # Valider les paramètres
    if params.merge_type not in ["inner", "left", "right", "outer"]:
        raise HTTPException(
            status_code=400, detail=f"Type de fusion {params.merge_type} non supporté"
        )
    if not all(ds.dataset_id in params.key_mappings for ds in params.datasets):
        raise HTTPException(
            status_code=400, detail="Clés de fusion manquantes pour certains datasets"
        )
    if params.suffixes and len(params.suffixes) < len(params.datasets):
        raise HTTPException(status_code=400, detail="Nombre de suffixes insuffisant")

    # Charger les datasets depuis MinIO
    dfs: list[tuple[int, pd.DataFrame]] = []
    for file in metadata["files"]:
        if file["dataset_id"] not in [ds.dataset_id for ds in params.datasets]:
            continue
        try:
            data = minio_client.download_file(file["path"])
            if file["format"] == "csv":
                df = pd.read_csv(io.BytesIO(data))
            elif file["format"] == "excel":
                df = pd.read_excel(io.BytesIO(data))
            elif file["format"] == "json":
                df = pd.read_json(io.BytesIO(data), orient="records")
            else:
                raise HTTPException(
                    status_code=400, detail=f"Format {file['format']} non supporté"
                )
            dfs.append((file["dataset_id"], df))  # Append tuple (dataset_id, DataFrame)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Erreur lors du chargement du fichier {file['dataset_id']} : {str(e)}",
            )

    # Vérifier la présence des colonnes de fusion
    for dataset_id, df in dfs:
        key = params.key_mappings.get(dataset_id)
        if key not in df.columns:
            raise HTTPException(
                status_code=400,
                detail=f"Clé {key} introuvable dans le dataset {dataset_id}",
            )

    # Fusionner les datasets
    try:
        result_df = dfs[0][1]  # Premier dataset
        suffixes = params.suffixes or [f"_{i}" for i in range(len(dfs))]
        if params.merge_type == "inner":
            how = "inner"
        elif params.merge_type == "left":
            how = "left"
        elif params.merge_type == "right":
            how = "right"
        elif params.merge_type == "outer":
            how = "outer"
        else:
            how = "inner"  # Par défaut, si type de fusion non reconnu
        for i, (dataset_id, df) in enumerate(dfs[1:], 1):
            key1 = params.key_mappings[dfs[0][0]]
            key2 = params.key_mappings[dataset_id]
            result_df = result_df.merge(
                df,
                how=how,
                left_on=key1,
                right_on=key2,
                suffixes=(suffixes[0], suffixes[i]),
            )

        # Gérer les doublons
        initial_rows = len(result_df)
        if params.duplicate_handling:
            keep = {
                "keep_first": "first",
                "keep_last": "last",
                "drop_duplicates": False,
            }.get(params.duplicate_handling, False)
            if keep:
                result_df = result_df.drop_duplicates(keep=keep)
        cleaning_summary = {"duplicates_removed": initial_rows - len(result_df)}

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
                output_data = result_df.to_csv(index=False).encode()
            elif params.output_format == "excel":
                with io.BytesIO() as buffer:
                    result_df.to_excel(buffer, index=False, engine="openpyxl")
                    output_data = buffer.getvalue()
            elif params.output_format == "json":
                output_data = result_df.to_json(orient="records", indent=2).encode()
            else:
                raise HTTPException(status_code=400, detail="Format de sortie invalide")
            minio_client.upload_file(result_path, output_data)
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Erreur lors de l'enregistrement : {str(e)}"
            )

        # Construire les métadonnées
        result_metadata = {
            "rows": len(result_df),
            "columns": list(result_df.columns),
            "merge_type": params.merge_type,
            "cleaning_summary": cleaning_summary,
        }

        return {"result_path": result_path, "metadata": result_metadata}
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f"Erreur lors de la fusion : {str(e)}"
        )
