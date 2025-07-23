const axios = require("axios");
const { NonFinalSources, ProcessingStates } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const mergeDatasets = async (
  userId,
  stateIds, // array of non_final_source_id
  keyMappings,
  mergeType,
  outputFormat,
  duplicateHandling,
  suffixes
) => {
  // Récupérer les états courants de chaque source à fusionner
  const filesInfo = [];
  const sourceIds = [];
  for (const stateId of stateIds) {
    // const source = await NonFinalSources.findOne({
    //   where: { non_final_source_id: sourceId, user_id: userId },
    // });
    // if (!source) {
    //   throw new Error(
    //     `Source non-finale avec ID ${sourceId} non trouvée ou non autorisée`
    //   );
    // }
    const state = await ProcessingStates.findOne({
      where: { state_id: stateId },
      // where: { non_final_source_id: sourceId, is_current: true },
      // order: [["created_at", "DESC"]],
    });
    if (!state) {
      throw new Error(`Aucun état courant trouvé pour la source ${stateId}`);
    }
    sourceIds.push(state.non_final_source_id);
    filesInfo.push({
      state_id: state.state_id,
      path: state.file_path,
      format: state.file_format,
    });
  }
  // const source_id = sourceIds[0]
  let lastState = await ProcessingStates.findOne({
    where: { parent_state_id: stateIds[0] },
    // where: { state_id: nonFinalSourceId, is_current: true },
    order: [["created_at", "DESC"]],
  });
  if (!lastState) {
    lastState = await ProcessingStates.findOne({
      where: { state_id: stateIds[0] },
      // where: { state_id: nonFinalSourceId, is_current: true },
      order: [["created_at", "DESC"]],
    });
  }

  const metadata = {
    user_id: userId,
    version: lastState.version,
    source_id: sourceIds[0],
    files: filesInfo,
  };

  const requestBody = {
    parameters: {
      state_ids: stateIds,
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
    // for (const sourceId of nonFinalSourceIds) {
    //   const prev = await ProcessingStates.findOne({
    //     where: { non_final_source_id: sourceId, is_current: true },
    //     order: [["created_at", "DESC"]],
    //   });
    //   if (prev) await prev.update({ is_current: false });
    // }

    const newState = await ProcessingStates.create({
      non_final_source_id: sourceIds[0],
      parent_state_id: stateIds[0],
      version: lastState.version + 1,
      is_current: true,
      file_path: result_path,
      file_format: outputFormat,
      transformation_type: "merge",
      transformation_parameters: {
        sources: sourceIds,
        key_mappings: keyMappings,
        merge_type: mergeType,
        duplicate_handling: duplicateHandling,
        suffixes: suffixes,
        ...resultMetadata,
      },
    });

    return {
      success: true,
      data: {
        state_id: newState.state_id,
        file_path: result_path,
        columns: resultMetadata.columns,
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
