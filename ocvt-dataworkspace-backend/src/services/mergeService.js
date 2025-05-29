const axios = require("axios");
const { ProcessingSteps, Datasets, DataSources } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const mergeDatasets = async (
  userId,
  datasetsToMerge,
  keyMappings,
  mergeType,
  outputFormat,
  duplicateHandling,
  suffixes
) => {
  const filesInfo = [];
  for (const ds of datasetsToMerge) {
    const dataset = await Datasets.findOne({
      where: { dataset_id: ds.dataset_id },
      include: [{ model: DataSources, where: { user_id: userId } }],
    });

    if (!dataset) {
      throw new Error(
        `Dataset avec ID ${ds.dataset_id} non trouvé ou non autorisé`
      );
    }
    filesInfo.push({
      dataset_id: dataset.dataset_id,
      path: dataset.data_content,
      format: dataset.data_format,
    });
  }

  const metadata = {
    user_id: userId,
    files: filesInfo,
  };

  const requestBody = {
    parameters: {
      datasets: datasetsToMerge,
      key_mappings: keyMappings,
      merge_type: mergeType,
      output_format: outputFormat,
      duplicate_handling: duplicateHandling,
      suffixes: suffixes,
    },
    metadata: metadata,
  };

  try {
    const response = await axios.post(
      `${PYTHON_API_URL}/merge-datasets/`,
      requestBody
    );

    const { result_path, metadata: resultMetadata } = response.data;

    // Créer un nouveau dataset pour le résultat de la fusion
    const newDataset = await Datasets.create({
      source_id: datasetsToMerge[0].dataset_id, // Utiliser le premier dataset comme source
      user_id: userId,
      dataset_name: `Fusion de datasets`,
      data_format: outputFormat,
      data_content: result_path,
      metadata: {},
    });

    // Enregistrer l'étape de traitement
    await ProcessingSteps.create({
      dataset_id: datasetsToMerge[0].dataset_id, // Associer au premier dataset fusionné
      step_type: "merge",
      step_description: `Fusion de datasets (${mergeType})`,
      parameters: {
        datasets: datasetsToMerge,
        key_mappings: keyMappings,
        merge_type: mergeType,
        duplicate_handling: duplicateHandling,
        suffixes: suffixes,
      },
      result_dataset_id: newDataset.dataset_id,
    });

    return {
      success: true,
      data: {
        dataset_id: newDataset.dataset_id,
        dataset_name: newDataset.dataset_name,
        file_path: result_path,
        merge_type: resultMetadata.merge_type,
        cleaning_summary: resultMetadata.cleaning_summary,
      },
      message: "Datasets fusionnés avec succès",
    };
  } catch (error) {
    // console.error(
    //   "Erreur lors de l'appel à l'API Python de fusion:",
    //   error.response?.data || error.message
    // );
    throw new Error(
      error.response?.data?.detail || "Erreur lors de la fusion des datasets"
    );
  }
};

module.exports = {
  mergeDatasets,
};
