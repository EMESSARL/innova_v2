const axios = require("axios");
const { NonFinalSources, ProcessingStates } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const detectAnomalies = async (
  userId,
  nonFinalSourceId,
  algorithm,
  hyperparameters,
  preprocessing,
  autoAlgorithmSelection,
  anomalyThreshold,
  outputFormat
) => {
  // Récupérer la source non-finale
  const datasetSource = await NonFinalSources.findOne({
    where: { non_final_source_id: nonFinalSourceId, user_id: userId },
  });
  if (!datasetSource) {
    throw new Error("Source non-finale non trouvée ou non autorisée");
  }

  // Récupérer l'état courant
  const previousState = await ProcessingStates.findOne({
    where: { non_final_source_id: nonFinalSourceId, is_current: true },
    order: [["created_at", "DESC"]],
  });
  if (!previousState) {
    throw new Error("Aucun état courant trouvé pour cette source");
  }

  const fileInfo = {
    state_id: previousState.state_id,
    path: previousState.file_path,
    format: previousState.file_format,
  };

  const metadata = {
    user_id: userId,
    files: [fileInfo],
  };

  const requestBody = {
    parameters: {
      state_id: previousState.state_id,
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

    // Marquer l'ancien état comme non courant
    await previousState.update({ is_current: false });

    // Créer le nouvel état de traitement
    const newState = await ProcessingStates.create({
      non_final_source_id: nonFinalSourceId,
      parent_state_id: previousState.state_id,
      version: previousState.version + 1,
      is_current: true,
      file_path: result_path,
      file_format: outputFormat,
      transformation_type: "anomaly_detection",
      transformation_parameters: {
        algorithm: algorithm,
        hyperparameters: hyperparameters,
        preprocessing: preprocessing,
        auto_algorithm_selection: autoAlgorithmSelection,
        anomaly_threshold: anomalyThreshold,
      },
    });

    return {
      success: true,
      data: {
        state_id: newState.state_id,
        file_path: result_path,
        anomaly_count: resultMetadata.anomaly_count,
        algorithm: resultMetadata.algorithm,
      },
      message: "Détection d'anomalies effectuée avec succès",
    };
  } catch (error) {
    throw new Error(
      error.response?.data?.detail ||
        "Erreur lors de la détection d'anomalies du dataset"
    );
  }
};

module.exports = {
  detectAnomalies,
};
