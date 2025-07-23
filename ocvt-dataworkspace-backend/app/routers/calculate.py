from typing import Any
from fastapi import APIRouter, HTTPException
import pandas as pd
import io
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
from asteval import Interpreter
from app.utils.minio_client import MinioClient

router = APIRouter()


class TestCase(BaseModel):
    """Cas de test pour valider la formule."""

    input_dict: dict[str, float | int | str | bool]
    expected: dict[str, float | int | str | bool]


class CalculateParameters(BaseModel):
    """Paramètres pour le calcul de la nouvelle colonne."""

    state_id: int
    new_column_name: str
    formula: str
    custom_functions: dict[str, str] | None = None
    tests: list[TestCase] | None = None
    overwrite: bool = False
    output_format: str


class RequestBody(BaseModel):
    """Corps de la requête pour le calcul de colonne."""

    parameters: CalculateParameters
    metadata: dict[str, Any]


def safe_eval_formula(
    formula: str,
    row: pd.Series,
    columns: list[str],
    custom_functions: dict[str, str] | None = None,
) -> float | int | str | bool | None:
    """
    Évalue une formule sécurisée sur une ligne de données.

    Args:
        formula: Expression à évaluer (ex. : "price * quantity").
        row: Ligne du DataFrame sous forme de Series.
        columns: Liste des colonnes disponibles.
        custom_functions: Fonctions personnalisées (nom -> expression).

    Returns:
        Résultat de l'évaluation.

    Raises:
        ValueError: Si la formule est invalide ou utilise des colonnes inconnues.
    """
    aeval = Interpreter()
    # Ajouter les colonnes comme variables
    for col in columns:
        aeval.symtable[col] = row[col] if pd.notna(row[col]) else None

    # Ajouter les fonctions personnalisées
    if custom_functions:
        for func_name, func_expr in custom_functions.items():
            # Créer une fonction dynamique
            try:
                aeval(f"def {func_name}(): return {func_expr}")
            except Exception as e:
                raise ValueError(
                    f"Erreur dans la fonction personnalisée {func_name} : {str(e)}"
                )

    try:
        result = aeval(formula)
        if aeval.error:
            raise ValueError(
                f"Erreur dans la formule : {aeval.error[0].get_error()[1]}"
            )
        if not isinstance(result, (float, int, str, bool, type(None))):
            raise ValueError(f"Type de retour invalide : {type(result).__name__}")
        return result
    except Exception as e:
        raise ValueError(f"Erreur lors de l'évaluation de la formule : {str(e)}")


def run_tests(
    tests: list[TestCase],
    formula: str,
    columns: list[str],
    custom_functions: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """
    Exécute les cas de test pour valider la formule.

    Args:
        tests: Liste des cas de test.
        formula: Expression à tester.
        columns: Liste des colonnes disponibles.
        custom_functions: Fonctions personnalisées.

    Returns:
        Liste des résultats des tests (input, expected, actual, passed).
    """
    results = []
    for test in tests:
        try:
            # Créer une Series à partir des données d'entrée
            input_data = {col: test.input_dict.get(col, None) for col in columns}
            row = pd.Series(input_data)
            actual = safe_eval_formula(formula, row, columns, custom_functions)
            expected_key = next(iter(test.expected))
            passed = actual == test.expected[expected_key]
            results.append(
                {
                    "input": test.input_dict,
                    "expected": test.expected[expected_key],
                    "actual": actual,
                    "passed": bool(passed),
                }
            )
        except Exception as e:
            results.append(
                {
                    "input": test.input_dict,
                    "expected": test.expected,
                    "actual": str(e),
                    "passed": False,
                }
            )
    return results


@router.post("/")
async def calculate_column(body: RequestBody) -> dict[str, Any]:
    """
    Ajoute une nouvelle colonne à un dataset en appliquant une formule.

    Args:
        body: Corps de la requête contenant les paramètres et métadonnées.

    Returns:
        Dictionnaire avec le chemin du résultat dans MinIO et les métadonnées.

    Raises:
        HTTPException: Si le fichier est introuvable, la formule est invalide ou les colonnes sont manquantes.
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

    # Vérifier si la colonne existe et si overwrite est autorisé
    if params.new_column_name in df.columns and not params.overwrite:
        raise HTTPException(
            status_code=400,
            detail=f"La colonne {params.new_column_name} existe déjà et overwrite est désactivé",
        )

    # Vérifier les colonnes référencées dans la formule
    aeval = Interpreter()
    try:
        aeval.parse(params.formula)
        used_columns = [
            sym for sym in aeval.symtable if isinstance(sym, str) and sym in df.columns
        ]
    except Exception:
        raise HTTPException(status_code=400, detail="Syntaxe de formule invalide")

    if not all(col in df.columns for col in used_columns):
        missing_cols = [col for col in used_columns if col not in df.columns]
        raise HTTPException(
            status_code=400,
            detail=f"Colonnes référencées introuvables : {missing_cols}",
        )

    # Exécuter les tests si fournis
    test_results = []
    if params.tests:
        test_results = run_tests(
            params.tests, params.formula, list(df.columns), params.custom_functions
        )

    # Appliquer la formule pour créer la nouvelle colonne
    # try:
    #     df[params.new_column_name] = df.apply(
    #         lambda row: safe_eval_formula(
    #             params.formula, row, list(df.columns), params.custom_functions
    #         ),
    #         axis=1,
    #     )
    # except ValueError as e:
    #     raise HTTPException(status_code=400, detail=str(e))

    try:
        df[params.new_column_name] = pd.Series(
            [
                safe_eval_formula(
                    params.formula, row, list(df.columns), params.custom_functions
                )
                for _, row in df.iterrows()
            ],
            index=df.index,
        )
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
        "new_column": params.new_column_name,
        "formula": params.formula,
        "test_results": test_results if test_results else None,
    }

    return {"result_path": result_path, "metadata": result_metadata}
