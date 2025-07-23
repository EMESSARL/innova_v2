const axios = require("axios");
const { NonFinalSources, ProcessingStates } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const predictDataset = async (
  userId,
  stateId,
  targetColumn,
  predictionType,
  model,
  hyperparameters,
  preprocessing,
  autoModelSelection,
  confidence,
  outputFormat
) => {
  // Récupérer la source non-finale
  // const datasetSource = await NonFinalSources.findOne({
  //   where: { non_final_source_id: nonFinalSourceId, user_id: userId },
  // });
  // if (!datasetSource) {
  //   throw new Error("Source non-finale non trouvée ou non autorisée");
  // }

  // Récupérer l'état courant
  const previousState = await ProcessingStates.findOne({
    where: { state_id: stateId },
    // where: { non_final_source_id: nonFinalSourceId, is_current: true },
    // order: [["created_at", "DESC"]],
  });
  if (!previousState) {
    throw new Error("Aucun état courant trouvé pour cette source");
  }
  let lastState = await ProcessingStates.findOne({
    where: { parent_state_id: previousState.state_id },
    // where: { state_id: nonFinalSourceId, is_current: true },
    order: [["created_at", "DESC"]],
  });
  if (!lastState) {
    lastState = await ProcessingStates.findOne({
      where: { state_id: stateId },
      // where: { state_id: nonFinalSourceId, is_current: true },
      order: [["created_at", "DESC"]],
    });
  }

  const fileInfo = {
    state_id: previousState.state_id,
    path: previousState.file_path,
    format: previousState.file_format,
  };

  const metadata = {
    user_id: userId,
    version: lastState.version,
    source_id: previousState.non_final_source_id,
    files: [fileInfo],
  };

  const requestBody = {
    parameters: {
      state_id: previousState.state_id,
      target_column: targetColumn,
      prediction_type: predictionType,
      model: model,
      hyperparameters: hyperparameters,
      preprocessing: preprocessing,
      auto_model_selection: autoModelSelection,
      confidence: confidence,
      output_format: outputFormat,
    },
    metadata: metadata,
  };

  try {
    const response = await axios.post(
      `${PYTHON_API_URL}/predict/`,
      requestBody
    );
    const { result_path, metadata: resultMetadata } = response.data;

    // Marquer l'ancien état comme non courant
    // await previousState.update({ is_current: false });

    // Créer le nouvel état de traitement
    const newState = await ProcessingStates.create({
      non_final_source_id: previousState.non_final_source_id,
      parent_state_id: previousState.state_id,
      version: lastState.version + 1,
      is_current: true,
      file_path: result_path,
      file_format: outputFormat,
      transformation_type: "predict",
      transformation_parameters: {
        target_column: targetColumn,
        prediction_type: predictionType,
        model: model,
        hyperparameters: hyperparameters,
        preprocessing: preprocessing,
        auto_model_selection: autoModelSelection,
        confidence: confidence,
        ...resultMetadata,
      },
    });

    return {
      success: true,
      data: {
        state_id: newState.state_id,
        file_path: result_path,
        columns: resultMetadata.columns,
        model: resultMetadata.model,
        prediction_type: resultMetadata.prediction_type,
        confidence: resultMetadata.confidence,
      },
      message: "Prédiction effectuée avec succès",
    };
  } catch (error) {
    throw new Error(
      error.response?.data?.detail || "Erreur lors de la prédiction du dataset"
    );
  }
};

module.exports = {
  predictDataset,
};
