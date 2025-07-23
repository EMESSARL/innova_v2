const axios = require("axios");
const { NonFinalSources, ProcessingStates } = require("../models");

const PYTHON_API_URL = process.env.PYTHON_API_URL;

const filterDataset = async (
  userId,
  stateId,
  conditions,
  nestedConditions,
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
      operation: "filter",
      conditions: conditions,
      nested_conditions: nestedConditions,
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
      transformation_type: "filter",
      transformation_parameters: {
        conditions,
        nested_conditions: nestedConditions,
        ...resultMetadata,
      },
    });

    return {
      success: true,
      data: {
        state_id: newState.state_id,
        file_path: result_path,
        columns: resultMetadata.columns,
        filtered_rows: resultMetadata.filtered_rows,
      },
      message: "Filtrage effectué avec succès",
    };
  } catch (error) {
    throw new Error(
      error.response?.data?.detail || "Erreur lors du filtrage du dataset"
    );
  }
};

module.exports = {
  filterDataset,
};
