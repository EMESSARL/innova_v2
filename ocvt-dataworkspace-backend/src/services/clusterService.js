const axios = require("axios");
const { ProcessingSteps, Datasets, DataSources } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const clusterDataset = async (
  userId,
  datasetId,
  algorithm,
  parameters,
  preprocessing,
  features,
  autoClusterSelection,
  metrics,
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
      parameters: parameters,
      preprocessing: preprocessing,
      features: features,
      auto_cluster_selection: autoClusterSelection,
      metrics: metrics,
      output_format: outputFormat,
    },
    metadata: metadata,
  };

  try {
    const response = await axios.post(
      `${PYTHON_API_URL}/cluster/`,
      requestBody
    );

    const { result_path, metadata: resultMetadata } = response.data;

    // Créer un nouveau dataset pour le résultat du clustering
    const newDataset = await Datasets.create({
      source_id: dataset.source_id,
      user_id: userId,
      dataset_name: `${dataset.dataset_name} - clusters`,
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
      step_type: "clustering",
      step_description: `Clustering avec l'algorithme ${algorithm}`,
      parameters: {
        algorithm: algorithm,
        parameters: parameters,
        preprocessing: preprocessing,
        features: features,
        auto_cluster_selection: autoClusterSelection,
        metrics: metrics,
      },
      result_dataset_id: newDataset.dataset_id,
    });

    return {
      success: true,
      data: {
        dataset_id: newDataset.dataset_id,
        dataset_name: newDataset.dataset_name,
        file_path: result_path,
        cluster_count: resultMetadata.cluster_count,
        algorithm: resultMetadata.algorithm,
        metrics: resultMetadata.metrics,
      },
      message: "Clustering effectué avec succès",
    };
  } catch (error) {
    // console.error(
    //   "Erreur lors de l'appel à l'API Python de clustering:",
    //   error.response?.data || error.message
    // );
    throw new Error(
      error.response?.data?.detail || "Erreur lors du clustering du dataset"
    );
  }
};

module.exports = {
  clusterDataset,
};
