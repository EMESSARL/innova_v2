const axios = require("axios");
const { ProcessingSteps, Datasets, DataSources } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const calculateColumn = async (
  userId,
  datasetId,
  newColumnName,
  formula,
  customFunctions,
  tests,
  overwrite,
  outputFormat
) => {
  const dataset = await Datasets.findOne({
    where: { dataset_id: datasetId },
    include: [{ model: DataSources, where: { user_id: userId } }],
  });

  if (!dataset) {
    throw new Error("Dataset non trouvé ou non autorisé");
  }

  const fileInfo = {
    dataset_id: dataset.dataset_id,
    path: dataset.data_content,
    format: dataset.data_format,
  };

  const metadata = {
    user_id: userId,
    files: [fileInfo],
  };

  const requestBody = {
    parameters: {
      dataset_id: datasetId,
      new_column_name: newColumnName,
      formula: formula,
      custom_functions: customFunctions,
      tests: tests,
      overwrite: overwrite,
      output_format: outputFormat,
    },
    metadata: metadata,
  };

  try {
    const response = await axios.post(
      `${PYTHON_API_URL}/calculate-column/`,
      requestBody
    );

    const { result_path, metadata: resultMetadata } = response.data;

    // Créer un nouveau dataset pour le résultat avec la nouvelle colonne
    const newDataset = await Datasets.create({
      source_id: dataset.source_id,
      user_id: userId,
      dataset_name: `${dataset.dataset_name} - avec ${newColumnName}`,
      data_format: outputFormat,
      data_content: result_path,
      metadata: {
        original_dataset_id: dataset.dataset_id,
        original_filename: dataset.dataset_name,
      },
    });

    // Enregistrer l'étape de traitement
    await ProcessingSteps.create({
      dataset_id: dataset.dataset_id,
      step_type: "calculate_column",
      step_description: `Calcul de la colonne ${newColumnName} avec la formule ${formula}`,
      parameters: {
        new_column_name: newColumnName,
        formula: formula,
        custom_functions: customFunctions,
        tests: tests,
        overwrite: overwrite,
      },
      result_dataset_id: newDataset.dataset_id,
    });

    return {
      success: true,
      data: {
        dataset_id: newDataset.dataset_id,
        dataset_name: newDataset.dataset_name,
        file_path: result_path,
        new_column: resultMetadata.new_column,
        formula: resultMetadata.formula,
        test_results: resultMetadata.test_results,
      },
      message: "Colonne calculée avec succès",
    };
  } catch (error) {
    console.error(
      "Erreur lors de l'appel à l'API Python de calcul de colonne:",
      error.response?.data || error.message
    );
    throw new Error(
      error.response?.data?.detail || "Erreur lors du calcul de la colonne"
    );
  }
};

module.exports = {
  calculateColumn,
};
