const axios = require("axios");
const { ProcessingSteps, Datasets, DataSources } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const aggregateDataset = async (
  userId,
  datasetId,
  groupBy,
  aggregations,
  having,
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
      operation: "aggregate",
      group_by: groupBy,
      aggregations: aggregations,
      having: having,
      output_format: outputFormat,
    },
    metadata: metadata,
  };

  try {
    const response = await axios.post(
      `${PYTHON_API_URL}/process-data/`,
      requestBody
    );

    const { result_path, metadata: resultMetadata } = response.data;

    // Créer un nouveau dataset pour le résultat agrégé
    const newDataset = await Datasets.create({
      source_id: dataset.source_id,
      user_id: userId,
      dataset_name: `${dataset.dataset_name} - agrégé`,
      data_format: outputFormat,
      data_content: result_path,
      metadata: {
        original_dataset_id: dataset.dataset_id,
        original_filename: dataset.metadata.original_filename,
      },
    });

    // Enregistrer l'étape de traitement
    await ProcessingSteps.create({
      dataset_id: dataset.dataset_id,
      step_type: "aggregate",
      step_description: "Agrégation de données",
      parameters: {
        group_by: groupBy,
        aggregations: aggregations,
        having: having,
      },
      result_dataset_id: newDataset.dataset_id,
    });

    return {
      success: true,
      data: {
        dataset_id: newDataset.dataset_id,
        dataset_name: newDataset.dataset_name,
        file_path: result_path,
        group_by_columns: resultMetadata.group_by_columns,
        aggregations_applied: resultMetadata.aggregations_applied,
      },
      message: "Dataset agrégé avec succès",
    };
  } catch (error) {
    // console.error(
    //   "Erreur lors de l'appel à l'API Python d'agrégation:",
    //   error.response?.data || error.message
    // );
    throw new Error(
      error.response?.data?.detail || "Erreur lors de l'agrégation du dataset"
    );
  }
};

module.exports = {
  aggregateDataset,
};
