const axios = require("axios");
const { ProcessingSteps, Datasets, DataSources } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const cleanDataset = async (
  userId,
  datasetId,
  cleaningActions,
  keepOriginal,
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
      cleaning_actions: cleaningActions,
      keep_original: keepOriginal,
      output_format: outputFormat,
    },
    metadata: metadata,
  };

  try {
    const response = await axios.post(
      `${PYTHON_API_URL}/clean-dataset/`,
      requestBody
    );

    const { result_path, metadata: resultMetadata } = response.data;

    // Créer un nouveau dataset pour le résultat nettoyé
    const newDataset = await Datasets.create({
      source_id: dataset.source_id,
      user_id: userId,
      dataset_name: `${dataset.dataset_name} - nettoyé`,
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
      step_type: "clean",
      step_description: "Nettoyage de données",
      parameters: cleaningActions,
      result_dataset_id: newDataset.dataset_id,
    });

    return {
      success: true,
      data: {
        dataset_id: newDataset.dataset_id,
        dataset_name: newDataset.dataset_name,
        file_path: result_path,
        cleaning_summary: resultMetadata.cleaning_summary,
      },
      message: "Dataset nettoyé avec succès",
    };
  } catch (error) {
    // console.error(
    //   "Erreur lors de l'appel à l'API Python de nettoyage:",
    //   error.response?.data || error.message
    // );
    throw new Error(
      error.response?.data?.detail || "Erreur lors du nettoyage du dataset"
    );
  }
};

module.exports = {
  cleanDataset,
};
