const axios = require("axios");
const { ProcessingSteps, Datasets, DataSources } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const predictDataset = async (
  userId,
  datasetId,
  targetColumn,
  predictionType,
  model,
  hyperparameters,
  preprocessing,
  autoModelSelection,
  confidence,
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

    // Créer un nouveau dataset pour le résultat de la prédiction
    const newDataset = await Datasets.create({
      source_id: dataset.source_id,
      user_id: userId,
      dataset_name: `${dataset.dataset_name} - prédiction`,
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
      step_type: "predict",
      step_description: `Prédiction (${predictionType}) avec le modèle ${model}`,
      parameters: {
        target_column: targetColumn,
        prediction_type: predictionType,
        model: model,
        hyperparameters: hyperparameters,
        preprocessing: preprocessing,
        auto_model_selection: autoModelSelection,
        confidence: confidence,
      },
      result_dataset_id: newDataset.dataset_id,
    });

    return {
      success: true,
      data: {
        dataset_id: newDataset.dataset_id,
        dataset_name: newDataset.dataset_name,
        file_path: result_path,
        model: resultMetadata.model,
        prediction_type: resultMetadata.prediction_type,
        confidence: resultMetadata.confidence,
      },
      message: "Prédiction effectuée avec succès",
    };
  } catch (error) {
    // console.error(
    //   "Erreur lors de l'appel à l'API Python de prédiction:",
    //   error.response?.data || error.message
    // );
    throw new Error(
      error.response?.data?.detail || "Erreur lors de la prédiction du dataset"
    );
  }
};

module.exports = {
  predictDataset,
};
