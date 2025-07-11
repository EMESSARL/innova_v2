const axios = require("axios");
const { NonFinalSources, ProcessingStates } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const mergeDatasets = async (
  userId,
  nonFinalSourceIds, // array of non_final_source_id
  keyMappings,
  mergeType,
  outputFormat,
  duplicateHandling,
  suffixes
) => {
  // Récupérer les états courants de chaque source à fusionner
  const filesInfo = [];
  for (const sourceId of nonFinalSourceIds) {
    const source = await NonFinalSources.findOne({
      where: { non_final_source_id: sourceId, user_id: userId },
    });
    if (!source) {
      throw new Error(
        `Source non-finale avec ID ${sourceId} non trouvée ou non autorisée`
      );
    }
    const state = await ProcessingStates.findOne({
      where: { non_final_source_id: sourceId, is_current: true },
      order: [["created_at", "DESC"]],
    });
    if (!state) {
      throw new Error(`Aucun état courant trouvé pour la source ${sourceId}`);
    }
    filesInfo.push({
      state_id: state.state_id,
      path: state.file_path,
      format: state.file_format,
    });
  }

  const metadata = {
    user_id: userId,
    files: filesInfo,
  };

  const requestBody = {
    parameters: {
      sources: nonFinalSourceIds,
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

    // Marquer tous les anciens états comme non courants
    for (const sourceId of nonFinalSourceIds) {
      const prev = await ProcessingStates.findOne({
        where: { non_final_source_id: sourceId, is_current: true },
        order: [["created_at", "DESC"]],
      });
      if (prev) await prev.update({ is_current: false });
    }

    // Créer un nouvel état de traitement pour la première source (pivot)
    const pivotSourceId = nonFinalSourceIds[0];
    const prevPivot = await ProcessingStates.findOne({
      where: { non_final_source_id: pivotSourceId },
      order: [["created_at", "DESC"]],
    });
    const newState = await ProcessingStates.create({
      non_final_source_id: pivotSourceId,
      parent_state_id: prevPivot ? prevPivot.state_id : null,
      version: prevPivot ? prevPivot.version + 1 : 1,
      is_current: true,
      file_path: result_path,
      file_format: outputFormat,
      transformation_type: "merge",
      transformation_parameters: {
        sources: nonFinalSourceIds,
        key_mappings: keyMappings,
        merge_type: mergeType,
        duplicate_handling: duplicateHandling,
        suffixes: suffixes,
      },
    });

    return {
      success: true,
      data: {
        state_id: newState.state_id,
        file_path: result_path,
        merge_type: resultMetadata.merge_type,
        cleaning_summary: resultMetadata.cleaning_summary,
      },
      message: "Fusion effectuée avec succès",
    };
  } catch (error) {
    throw new Error(
      error.response?.data?.detail || "Erreur lors de la fusion des sources"
    );
  }
};

module.exports = {
  mergeDatasets,
};
