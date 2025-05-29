const axios = require("axios");
const { ProcessingSteps, Datasets, DataSources } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const detectAnomalies = async (
  userId,
  datasetId,
  algorithm,
  hyperparameters,
  preprocessing,
  autoAlgorithmSelection,
  anomalyThreshold,
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
      algorithm: algorithm,
      hyperparameters: hyperparameters,
      preprocessing: preprocessing,
      auto_algorithm_selection: autoAlgorithmSelection,
      anomaly_threshold: anomalyThreshold,
      output_format: outputFormat,
    },
    metadata: metadata,
  };

  try {
    const response = await axios.post(
      `${PYTHON_API_URL}/detect-anomalies/`,
      requestBody
    );

    const { result_path, metadata: resultMetadata } = response.data;

    // Créer un nouveau dataset pour le résultat de la détection d'anomalies
    const newDataset = await Datasets.create({
      source_id: dataset.source_id,
      user_id: userId,
      dataset_name: `${dataset.dataset_name} - anomalies`,
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
      step_type: "anomaly_detection",
      step_description: `Détection d'anomalies avec l'algorithme ${algorithm}`,
      parameters: {
        algorithm: algorithm,
        hyperparameters: hyperparameters,
        preprocessing: preprocessing,
        auto_algorithm_selection: autoAlgorithmSelection,
        anomaly_threshold: anomalyThreshold,
      },
      result_dataset_id: newDataset.dataset_id,
    });

    return {
      success: true,
      data: {
        dataset_id: newDataset.dataset_id,
        dataset_name: newDataset.dataset_name,
        file_path: result_path,
        anomaly_count: resultMetadata.anomaly_count,
        algorithm: resultMetadata.algorithm,
      },
      message: "Détection d'anomalies effectuée avec succès",
    };
  } catch (error) {
    // console.error(
    //   "Erreur lors de l'appel à l'API Python de détection d'anomalies:",
    //   error.response?.data || error.message
    // );
    throw new Error(
      error.response?.data?.detail ||
        "Erreur lors de la détection d'anomalies du dataset"
    );
  }
};

module.exports = {
  detectAnomalies,
};
