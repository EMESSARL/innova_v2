const {
  DataSources,
  Datasets,
  ProcessingSteps,
  Results,
  Submissions,
} = require("../models");
const minioClient = require("../config/minioClient");
const axios = require("axios");
const Papa = require("papaparse");
const XLSX = require("xlsx");
const xml2js = require("xml2js");
const shapefile = require("shapefile");
const JSZip = require("jszip");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const tf = require("@tensorflow/tfjs-node");
const math = require("mathjs");
const AdmZip = require("adm-zip");
const {
  streamToBuffer,
  flattenXml,
  handleZippedShapefile,
  validateMimeType,
} = require("./utils");

const BUCKET_NAME = process.env.MINIO_BUCKET;

// Lister les sources de données de l'utilisateur
const listDataSources = async (userId) => {
  const sources = await DataSources.findAll({
    where: { user_id: userId },
    attributes: [
      "source_id",
      "source_type",
      "source_name",
      "connection_details",
      "created_at",
      "updated_at",
    ],
  });

  if (!sources || sources.length === 0) {
    throw new Error("Aucune source de données trouvée pour cet utilisateur");
  }

  return { success: true, data: sources };
};

// Ajouter une nouvelle source de données
const addDataSource = async (
  userId,
  sourceType,
  sourceName,
  file,
  connectionDetails
) => {
  const validSourceTypes = ["file", "database", "api"];
  if (!validSourceTypes.includes(sourceType)) {
    throw new Error(
      "Type de source invalide. Valeurs acceptées : file, database, api"
    );
  }

  if (!sourceName || sourceName.trim() === "") {
    throw new Error("Le nom de la source est requis");
  }

  let filePath;
  let dataFormat;

  // Créer d'abord l'entrée dans DataSources pour obtenir source_id
  const newSource = await DataSources.create({
    user_id: userId,
    source_type: sourceType,
    source_name: sourceName,
    connection_details: null, // Sera mis à jour après selon le type
    // created_at: new Date(),
    // updated_at: new Date(),
  });

  if (sourceType === "file") {
    if (!file) {
      throw new Error('Un fichier est requis pour le type "file"');
    }

    const validExtensions = ["csv", "xls", "xlsx", "json", "xml", "shp", "zip"];
    const fileExtension = file.originalname.split(".").pop().toLowerCase();
    if (!validExtensions.includes(fileExtension)) {
      throw new Error(
        "Format de fichier non pris en charge. Formats acceptés : csv, xls, xlsx, json, xml, shp, zip"
      );
    }

    if (fileExtension === "xls" || fileExtension === "xlsx") {
      dataFormat = "excel";
    } else if (fileExtension === "shp" || fileExtension === "zip") {
      dataFormat = "shapefile";
    } else {
      dataFormat = fileExtension;
    }

    // dataFormat =
    //   fileExtension === "xls" || fileExtension === "xlsx"
    //     ? "excel"
    //     : fileExtension;
    filePath = `dataworkspace/sources/${userId}/${Date.now()}_${
      file.originalname
    }`;
    await minioClient.putObject(BUCKET_NAME, filePath, file.buffer);

    // Mettre à jour connection_details avec le file_path
    await newSource.update({ connection_details: { file_path: filePath } });
  }
  /* else if (sourceType === "database") {
    if (
      !connectionDetails ||
      !connectionDetails.url ||
      !connectionDetails.credentials
    ) {
      throw new Error(
        'URL et identifiants sont requis pour une source "database"'
      );
    }

    // Simulation (à remplacer par une vraie connexion SQL si nécessaire)
    const simulatedData = [{ id: 1, name: "Exemple" }];
    const dataBuffer = Buffer.from(JSON.stringify(simulatedData));
    filePath = `dataworkspace/sources/${userId}/${Date.now()}_${sourceName}.json`;
    await minioClient.putObject(BUCKET_NAME, filePath, dataBuffer);
    dataFormat = "json";

    await newSource.update({ connection_details });
  } else if (sourceType === "api") {
    if (!connectionDetails || !connectionDetails.url) {
      throw new Error('URL est requise pour une source "api"');
    }

    const response = await axios.get(connectionDetails.url, {
      headers: connectionDetails.credentials
        ? { Authorization: `Bearer ${connectionDetails.credentials.token}` }
        : {},
    });
    const apiData = response.data;
    const dataBuffer = Buffer.from(JSON.stringify(apiData));
    filePath = `dataworkspace/sources/${userId}/${Date.now()}_${sourceName}.json`;
    await minioClient.putObject(BUCKET_NAME, filePath, dataBuffer);
    dataFormat = "json";

    await newSource.update({ connection_details });
  } */

  // Créer l'entrée dans Datasets avec le source_id dès le départ
  await Datasets.create({
    source_id: newSource.source_id,
    user_id: userId,
    dataset_name: sourceName,
    data_format: dataFormat,
    data_content: filePath,
    metadata:
      sourceType === "file"
        ? { original_filename: file?.originalname }
        : { source: sourceType, url: connectionDetails?.url },
    // created_at: new Date(),
    // updated_at: new Date(),
  });

  return {
    success: true,
    data: { source_id: newSource.source_id },
    message: "Source de données ajoutée avec succès",
  };
};

// Supprimer une source de données
const deleteDataSource = async (userId, sourceId) => {
  const source = await DataSources.findOne({
    where: { source_id: sourceId, user_id: userId },
  });

  if (!source) {
    throw new Error("Source de données non trouvée ou non autorisée");
  }

  if (source.source_type === "file" && source.connection_details?.file_path) {
    await minioClient.removeObject(
      BUCKET_NAME,
      source.connection_details.file_path
    );
  }

  await Datasets.destroy({ where: { source_id: sourceId } });
  await source.destroy();

  return { success: true, message: "Source de données supprimée avec succès" };
};

// Charger les données d'une source spécifique
const loadDataFromSource = async (userId, sourceId, limit = 10, offset = 0) => {
  const source = await DataSources.findOne({
    where: { source_id: sourceId, user_id: userId },
  });

  if (!source) {
    throw new Error("Source de données non trouvée ou non autorisée");
  }

  const dataset = await Datasets.findOne({
    where: { source_id: sourceId },
  });

  if (!dataset) {
    throw new Error("Aucun jeu de données associé à cette source");
  }

  const fileStream = await minioClient.getObject(
    BUCKET_NAME,
    dataset.data_content
  );
  const fileData = await streamToBuffer(fileStream);

  let parsedData;
  switch (dataset.data_format) {
    case "csv":
      parsedData = Papa.parse(fileData.toString("utf-8"), {
        header: true,
      }).data;
      break;
    case "excel":
      const workbook = XLSX.read(fileData, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      parsedData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      break;
    case "json":
      parsedData = JSON.parse(fileData.toString("utf-8"));
      break;
    case "xml":
      parsedData = await xml2js.parseStringPromise(fileData.toString("utf-8"));
      parsedData = flattenXml(parsedData);
      break;
    case "shapefile":
      try {
        // Vérifier si c'est un fichier zip (en regardant les premiers octets)
        const isZip =
          fileData[0] === 0x50 &&
          fileData[1] === 0x4b &&
          fileData[2] === 0x03 &&
          fileData[3] === 0x04;

        if (isZip) {
          // Traiter comme un zip contenant des shapefiles
          parsedData = await handleZippedShapefile(fileData);
        } else {
          // Traiter comme un shapefile directement
          const source = await shapefile.open(fileData);
          const collection = { type: "FeatureCollection", features: [] };
          let result;
          while ((result = await source.read()) && !result.done) {
            collection.features.push(result.value);
          }
          parsedData = collection.features;
        }
      } catch (error) {
        throw new Error(
          `Erreur lors du traitement du shapefile: ${error.message}`
        );
      }
      break;
    default:
      throw new Error("Format de données non pris en charge");
  }

  if (!Array.isArray(parsedData)) {
    parsedData = [parsedData];
  }

  const total = parsedData.length;
  const paginatedData = parsedData.slice(offset, offset + limit);

  return {
    success: true,
    data: {
      source_id: source.source_id,
      source_type: source.source_type,
      source_name: source.source_name,
      content: paginatedData,
      pagination: { limit, offset, total },
    },
  };
};

// Appliquer une transformation sur les données
const applyDataTransformation = async (
  userId,
  sourceId,
  transformationType,
  parameters
) => {
  // Validation des entrées
  const validTransformationTypes = ["clean", "filter", "aggregate", "compute"];
  if (!validTransformationTypes.includes(transformationType)) {
    throw new Error(
      "Type de transformation invalide. Valeurs acceptées : clean, filter, aggregate, compute"
    );
  }

  // Vérifier la source et le dataset
  const source = await DataSources.findOne({
    where: { source_id: sourceId, user_id: userId },
  });
  if (!source) {
    throw new Error("Source de données non trouvée ou non autorisée");
  }

  const dataset = await Datasets.findOne({
    where: { source_id: sourceId },
  });
  if (!dataset) {
    throw new Error("Aucun jeu de données associé à cette source");
  }

  // Charger les données depuis MinIO
  const fileStream = await minioClient.getObject(
    BUCKET_NAME,
    dataset.data_content
  );
  const fileData = await streamToBuffer(fileStream);
  let data;

  // Parser les données selon le format
  if (dataset.data_format === "csv") {
    data = Papa.parse(fileData.toString("utf-8"), { header: true }).data;
  } else if (dataset.data_format === "excel") {
    const workbook = XLSX.read(fileData, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  } else {
    throw new Error(
      "Format de données non pris en charge pour la transformation"
    );
  }

  let transformedData = [...data];
  let stepDescription = "";

  // Appliquer la transformation
  switch (transformationType) {
    case "clean":
      if (parameters.remove_duplicates) {
        transformedData = removeDuplicates(transformedData);
        stepDescription += "Suppression des doublons. ";
      }
      if (parameters.handle_missing) {
        transformedData = handleMissingValues(
          transformedData,
          parameters.handle_missing
        );
        stepDescription += `Gestion des valeurs manquantes : ${parameters.handle_missing.method}. `;
      }
      break;
    case "filter":
      if (!parameters.criteria) {
        throw new Error("Critères de filtrage requis");
      }
      transformedData = filterData(transformedData, parameters.criteria);
      stepDescription = `Filtrage sur ${parameters.criteria.column} ${parameters.criteria.operator} ${parameters.criteria.value}`;
      break;
    case "aggregate":
      if (!parameters.group_by || !parameters.aggregations) {
        throw new Error("Paramètres group_by et aggregations requis");
      }
      transformedData = aggregateData(
        transformedData,
        parameters.group_by,
        parameters.aggregations
      );
      stepDescription = `Agrégation par ${parameters.group_by.join(", ")}`;
      break;
    // case "compute":
    //   if (!parameters.new_column) {
    //     throw new Error("Paramètres new_column requis");
    //   }
    //   transformedData = computeNewColumn(
    //     transformedData,
    //     parameters.new_column
    //   );
    //   stepDescription = `Calcul de la colonne ${parameters.new_column.name}`;
    //   break;
    default:
      throw new Error("Type de transformation non pris en charge");
  }

  // Stocker les données transformées dans MinIO
  // console.log(dataset.metadata);
  const fileName = dataset.metadata.original_filename
    .split(".")
    .slice(0, -1)
    .join(".");
  let newFilePath = `dataworkspace/transformed/${userId}/${Date.now()}_${fileName}_transformed`;
  let fileBuffer;

  if (dataset.data_format === "csv") {
    const csvData = Papa.unparse(transformedData);
    fileBuffer = Buffer.from(csvData);
    newFilePath += ".csv";
  } else if (dataset.data_format === "excel") {
    const worksheet = XLSX.utils.json_to_sheet(transformedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    newFilePath += ".xlsx";
  } else {
    throw new Error("Format de données non pris en charge pour la sauvegarde");
  }

  await minioClient.putObject(BUCKET_NAME, newFilePath, fileBuffer);

  // Créer un nouveau dataset
  const newDataset = await Datasets.create({
    source_id: source.source_id,
    user_id: userId,
    dataset_name: `${dataset.dataset_name} - transformé`,
    data_format: dataset.data_format,
    data_content: newFilePath,
    metadata: {
      original_dataset_id: dataset.dataset_id,
      original_filename: dataset.metadata.original_filename,
      transformation_type: transformationType,
    },
  });

  // Enregistrer l'étape de transformation
  await ProcessingSteps.create({
    dataset_id: dataset.dataset_id,
    step_type: transformationType,
    step_description: stepDescription || `Transformation ${transformationType}`,
    parameters: parameters,
    result_dataset_id: newDataset.dataset_id,
  });

  return {
    success: true,
    data: {
      dataset_id: newDataset.dataset_id,
      dataset_name: newDataset.dataset_name,
      file_path: newFilePath,
    },
    message: "Transformation appliquée avec succès",
  };
};

// Fonctions utilitaires pour les transformations
const removeDuplicates = (data) => {
  const seen = new Set();
  return data.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const handleMissingValues = (data, options) => {
  if (options.method === "drop") {
    return data.filter((row) =>
      Object.values(row).every(
        (val) => val !== null && val !== undefined && val !== ""
      )
    );
  } else if (options.method === "fill") {
    const fillValue = options.value ?? "";
    return data.map((row) => {
      const newRow = { ...row };
      Object.keys(newRow).forEach((key) => {
        if (
          newRow[key] === null ||
          newRow[key] === undefined ||
          newRow[key] === ""
        ) {
          newRow[key] = fillValue;
        }
      });
      return newRow;
    });
  }
  return data;
};

const filterData = (data, criteria) => {
  const { column, operator, value } = criteria;
  return data.filter((row) => {
    const cellValue = row[column];
    if (cellValue === undefined) return false;
    switch (operator) {
      case "eq":
        return cellValue == value;
      case "gt":
        return cellValue > value;
      case "lt":
        return cellValue < value;
      case "geq":
        return cellValue >= value;
      case "leq":
        return cellValue <= value;
      case "neq":
        return cellValue != value;
      default:
        return false;
    }
  });
};

const aggregateData = (data, groupBy, aggregations) => {
  const grouped = {};
  data.forEach((row) => {
    const key = groupBy.map((col) => row[col]).join("||");
    if (!grouped[key]) {
      // Initialiser le groupe avec uniquement les colonnes group_by
      grouped[key] = {};
      groupBy.forEach((col) => {
        grouped[key][col] = row[col];
      });
      grouped[key].count = 1;
      // Initialiser les colonnes d'agrégation
      aggregations.forEach((agg) => {
        const current = parseFloat(row[agg.column]) || 0;
        grouped[key][agg.output_column] = current;
      });
    } else {
      grouped[key].count += 1;
      aggregations.forEach((agg) => {
        const current = parseFloat(row[agg.column]) || 0;
        if (agg.function === "sum" || agg.function === "avg") {
          grouped[key][agg.output_column] += current;
        } else if (agg.function === "min") {
          grouped[key][agg.output_column] = Math.min(
            grouped[key][agg.output_column],
            current
          );
        } else if (agg.function === "max") {
          grouped[key][agg.output_column] = Math.max(
            grouped[key][agg.output_column],
            current
          );
        } else if (agg.function === "count") {
          grouped[key][agg.output_column] = grouped[key].count;
        }
      });
    }
  });

  // Finaliser les moyennes et supprimer les colonnes inutiles
  const result = Object.values(grouped).map((group) => {
    const finalGroup = {};
    // Copier les colonnes group_by
    groupBy.forEach((col) => {
      finalGroup[col] = group[col];
    });
    // Copier et finaliser les colonnes agrégées
    aggregations.forEach((agg) => {
      if (agg.function === "avg") {
        finalGroup[agg.output_column] = group[agg.output_column] / group.count;
      } else {
        finalGroup[agg.output_column] = group[agg.output_column];
      }
    });
    return finalGroup;
  });

  return result;
};

// const aggregateData = (data, groupBy, aggregations) => {
//   const grouped = {};
//   data.forEach((row) => {
//     const key = groupBy.map((col) => row[col]).join("||");
//     if (!grouped[key]) {
//       grouped[key] = { ...row, count: 1 };
//       groupBy.forEach((col) => {
//         grouped[key][col] = row[col];
//       });
//     } else {
//       grouped[key].count += 1;
//       aggregations.forEach((agg) => {
//         const current = parseFloat(row[agg.column]) || 0;
//         if (!grouped[key][agg.output_column]) {
//           grouped[key][agg.output_column] = current;
//         } else {
//           switch (agg.function) {
//             case "sum":
//               grouped[key][agg.output_column] += current;
//               break;
//             case "avg":
//               grouped[key][agg.output_column] += current;
//               break;
//             case "min":
//               grouped[key][agg.output_column] = Math.min(
//                 grouped[key][agg.output_column],
//                 current
//               );
//               break;
//             case "max":
//               grouped[key][agg.output_column] = Math.max(
//                 grouped[key][agg.output_column],
//                 current
//               );
//               break;
//             case "count":
//               grouped[key][agg.output_column] = grouped[key].count;
//               break;
//           }
//         }
//       });
//     }
//   });

//   // Calculer les moyennes pour avg
//   Object.values(grouped).forEach((group) => {
//     aggregations.forEach((agg) => {
//       if (agg.function === "avg") {
//         group[agg.output_column] = group[agg.output_column] / group.count;
//       }
//     });
//     delete group.count;
//   });

//   return Object.values(grouped);
// };

// const computeNewColumn = (data, newColumn) => {
//   return data.map((row) => {
//     let value;
//     try {
//       // Évaluer la formule de manière sécurisée (simplifiée ici)
//       // Note : Dans une vraie implémentation, utiliser une bibliothèque comme math.js pour éviter les injections
//       value = evalFormula(row, newColumn.formula);
//     } catch (error) {
//       value = null;
//     }
//     return { ...row, [newColumn.name]: value };
//   });
// };

// const evalFormula = (row, formula) => {
//   // Simplification pour l'exemple : remplace les noms de colonnes par leurs valeurs
//   let expression = formula;
//   Object.keys(row).forEach((key) => {
//     const value = row[key];
//     if (typeof value === "number") {
//       expression = expression.replace(new RegExp(`\\b${key}\\b`, "g"), value);
//     }
//   });
//   return eval(expression); // À remplacer par une solution sécurisée comme math.js
// };

// Effectuer une analyse sur les données
const performDataAnalysis = async (
  userId,
  sourceId,
  analysisType,
  parameters
) => {
  const validAnalysisTypes = ["stats", "prediction", "anomaly", "clustering"];
  if (!validAnalysisTypes.includes(analysisType)) {
    throw new Error(
      "Type d'analyse invalide. Valeurs acceptées : stats, prediction, anomaly, clustering"
    );
  }

  // Vérifier la source et le dataset
  const source = await DataSources.findOne({
    where: { source_id: sourceId, user_id: userId },
  });
  if (!source) {
    throw new Error("Source de données non trouvée ou non autorisée");
  }

  const dataset = await Datasets.findOne({
    where: { source_id: sourceId },
  });
  if (!dataset) {
    throw new Error("Aucun jeu de données associé à cette source");
  }

  // Charger les données depuis MinIO
  const fileStream = await minioClient.getObject(
    BUCKET_NAME,
    dataset.data_content
  );
  const fileData = await streamToBuffer(fileStream);
  let data;

  if (dataset.data_format === "csv") {
    data = Papa.parse(fileData.toString("utf-8"), { header: true }).data;
  } else if (dataset.data_format === "excel") {
    const workbook = XLSX.read(fileData, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  } else {
    throw new Error("Format de données non pris en charge pour l'analyse");
  }

  let result;
  let stepDescription = "";
  let newDataset = null;

  // Effectuer l'analyse
  switch (analysisType) {
    case "stats":
      if (!parameters.columns || !Array.isArray(parameters.columns)) {
        throw new Error("Colonnes à analyser requises");
      }
      result = computeDescriptiveStats(data, parameters.columns);
      stepDescription = `Statistiques descriptives sur ${parameters.columns.join(
        ", "
      )}`;
      break;
    case "prediction":
      if (
        !parameters.features ||
        !parameters.target ||
        !parameters.model_type
      ) {
        throw new Error("Paramètres features, target et model_type requis");
      }
      result = await performPrediction(
        data,
        parameters.features,
        parameters.target,
        parameters.model_type
      );
      stepDescription = `Prédiction (${parameters.model_type}) sur ${parameters.target}`;
      break;
    case "anomaly":
      if (!parameters.columns || !parameters.method) {
        throw new Error("Colonnes et méthode requises");
      }
      result = detectAnomalies(
        data,
        parameters.columns,
        parameters.method,
        parameters.threshold
      );
      stepDescription = `Détection d'anomalies (${
        parameters.method
      }) sur ${parameters.columns.join(", ")}`;
      break;
    case "clustering":
      if (!parameters.columns || !parameters.k) {
        throw new Error("Colonnes et nombre de clusters (k) requis");
      }
      result = await performClustering(data, parameters.columns, parameters.k);
      stepDescription = `Clustering (k=${
        parameters.k
      }) sur ${parameters.columns.join(", ")}`;

      // Créer un nouveau dataset pour le clustering
      // const timestamp = Date.now();
      // const newFilePath = `dataworkspace/analyzed/${userId}/${timestamp}_${dataset.dataset_name}_clustered.${dataset.data_format}`;
      // let fileBuffer;
      // if (dataset.data_format === "csv") {
      //   const csvData = Papa.unparse(result.data);
      //   fileBuffer = Buffer.from(csvData);
      // } else if (dataset.data_format === "excel") {
      //   const worksheet = XLSX.utils.json_to_sheet(result.data);
      //   const workbook = XLSX.utils.book_new();
      //   XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
      //   fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      // }
      // await minioClient.putObject(BUCKET_NAME, newFilePath, fileBuffer);

      // newDataset = await Datasets.create({
      //   source_id: source.source_id,
      //   user_id: userId,
      //   dataset_name: `${dataset.dataset_name}_clustered`,
      //   data_format: dataset.data_format,
      //   data_content: newFilePath,
      //   metadata: {
      //     original_dataset_id: dataset.dataset_id,
      //     analysis_type: analysisType,
      //   },
      // });
      break;
    default:
      throw new Error("Type d'analyse non pris en charge");
  }

  // Enregistrer l'étape d'analyse
  // await ProcessingSteps.create({
  //   dataset_id: dataset.dataset_id,
  //   step_type: analysisType,
  //   step_description: stepDescription || `Analyse ${analysisType}`,
  //   parameters: parameters,
  //   result_dataset_id: newDataset ? newDataset.dataset_id : null,
  // });

  return {
    success: true,
    data: result,
    dataset: newDataset
      ? {
          dataset_id: newDataset.dataset_id,
          dataset_name: newDataset.dataset_name,
        }
      : null,
    message: "Analyse effectuée avec succès",
  };
};

// Fonctions utilitaires pour les analyses
const computeDescriptiveStats = (data, columns) => {
  const stats = {};
  columns.forEach((col) => {
    const values = data
      .map((row) => parseFloat(row[col]))
      .filter((val) => !isNaN(val));
    if (values.length === 0) {
      stats[col] = { error: "Aucune valeur numérique valide" };
      return;
    }
    stats[col] = {
      count: values.length,
      mean: math.mean(values),
      median: math.median(values),
      std: math.std(values),
      min: math.min(values),
      max: math.max(values),
    };
  });
  return stats;
};

const performPrediction = async (data, features, target, modelType) => {
  if (data.length < 2) {
    throw new Error(
      "Le dataset doit contenir au moins 2 lignes pour la prédiction"
    );
  }

  // Préparer les données
  const X = data.map((row) => features.map((f) => parseFloat(row[f]) || 0));
  const y = data.map(
    (row) => parseFloat(row[target]) || (modelType === "classification" ? 0 : 0)
  );

  // Normaliser les features
  const xTensor = tf.tensor2d(X);
  const xMean = xTensor.mean(0);
  const xStd = tf.sqrt(xTensor.sub(xMean).square().mean(0));
  const xNormalized = xTensor.sub(xMean).div(xStd.add(1e-8));

  // Normaliser la target (pour régression)
  let yTensor = tf.tensor1d(
    y,
    modelType === "classification" ? "int32" : "float32"
  );
  let yMean, yStd, yNormalized;
  if (modelType === "regression") {
    yMean = yTensor.mean();
    yStd = tf.sqrt(yTensor.sub(yMean).square().mean());
    yNormalized = yTensor.sub(yMean).div(yStd.add(1e-8));
  } else {
    yNormalized = yTensor;
  }

  // Diviser en train/test (80/20)
  const trainSize = Math.floor(0.8 * X.length);
  const indices = Array.from({ length: X.length }, (_, i) => i);
  // Mélanger manuellement
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const trainIndices = indices.slice(0, trainSize);
  const testIndices = indices.slice(trainSize);

  const xTrain = xNormalized.gather(trainIndices);
  const yTrain = yNormalized.gather(trainIndices);
  const xTest =
    testIndices.length > 0 ? xNormalized.gather(testIndices) : xNormalized; // Fallback si test vide
  const yTest =
    testIndices.length > 0 ? yNormalized.gather(testIndices) : yNormalized;

  // Créer un modèle plus robuste
  const model = tf.sequential();
  model.add(
    tf.layers.dense({
      units: 16,
      inputShape: [features.length],
      activation: "relu",
    })
  );
  model.add(tf.layers.dense({ units: modelType === "classification" ? 1 : 1 }));
  if (modelType === "classification") {
    model.add(tf.layers.activation({ activation: "sigmoid" }));
  }

  model.compile({
    optimizer: tf.train.adam(0.01),
    loss:
      modelType === "classification"
        ? "binaryCrossentropy"
        : "meanSquaredError",
    metrics: ["accuracy"],
  });

  // Entraîner le modèle
  await model.fit(xTrain, yTrain, {
    epochs: 50,
    batchSize: 32,
    validationSplit: 0.2,
    verbose: 0,
  });

  // Évaluer sur l'ensemble de test
  const evalResult = model.evaluate(xTest, yTest, { batchSize: 32 });
  const loss = evalResult[0].dataSync()[0];
  const accuracy = evalResult[1].dataSync()[0];

  // Faire des prédictions sur toutes les données
  const predictionsTensor = model.predict(xNormalized);
  let predictions = predictionsTensor.dataSync();
  if (modelType === "regression") {
    predictions = predictions.map(
      (p) => p * yStd.dataSync()[0] + yMean.dataSync()[0]
    );
  } else {
    predictions = predictions.map((p) => Math.round(p));
  }

  // Associer les prédictions aux données
  const results = data.map((row, i) => ({
    ...row,
    prediction: predictions[i],
  }));

  // Nettoyer les tensors
  tf.dispose([
    xTensor,
    xNormalized,
    yTensor,
    yNormalized,
    xTrain,
    yTrain,
    xTest,
    yTest,
    predictionsTensor,
    model,
  ]);

  return {
    data: results,
    model_metrics: {
      loss: loss,
      accuracy: accuracy,
      train_size: trainSize,
      test_size: X.length - trainSize,
    },
  };
};

// const performPrediction = async (data, features, target, modelType) => {
//   // Préparer les données
//   const X = data.map((row) => features.map((f) => parseFloat(row[f]) || 0));
//   const y = data.map(
//     (row) => parseFloat(row[target]) || (modelType === "classification" ? 0 : 0)
//   );

//   // Créer et entraîner un modèle simple
//   const model = tf.sequential();
//   model.add(
//     tf.layers.dense({
//       units: modelType === "classification" ? 1 : 1,
//       inputShape: [features.length],
//     })
//   );
//   if (modelType === "classification") {
//     model.add(tf.layers.activation({ activation: "sigmoid" }));
//   }
//   model.compile({
//     optimizer: "adam",
//     loss:
//       modelType === "classification"
//         ? "binaryCrossentropy"
//         : "meanSquaredError",
//     metrics: ["accuracy"],
//   });

//   const xs = tf.tensor2d(X);
//   const ys = tf.tensor1d(
//     y,
//     modelType === "classification" ? "int32" : "float32"
//   );
//   await model.fit(xs, ys, { epochs: 10, verbose: 1 });

//   // Faire des prédictions
//   const predictions = model.predict(xs).dataSync();
//   const results = data.map((row, i) => ({
//     ...row,
//     prediction:
//       modelType === "classification"
//         ? Math.round(predictions[i])
//         : predictions[i],
//   }));

//   tf.dispose([xs, ys, model]);
//   return { data: results, model_metrics: { epochs: 10 } };
// };

const detectAnomalies = (data, columns, method, threshold = 3) => {
  if (method === "zscore") {
    const anomalies = [];
    columns.forEach((col) => {
      const values = data
        .map((row) => parseFloat(row[col]))
        .filter((v) => !isNaN(v));
      if (values.length === 0) return;
      const mean = math.mean(values);
      const std = math.std(values);
      data.forEach((row, i) => {
        const value = parseFloat(row[col]);
        if (!isNaN(value)) {
          const zScore = Math.abs((value - mean) / std);
          if (zScore > threshold) {
            anomalies.push({ index: i, column: col, z_score: zScore });
          }
        }
      });
    });
    return { anomalies };
  }
  throw new Error("Méthode de détection d'anomalies non prise en charge");
};

const performClustering = async (data, columns, k) => {
  if (k > data.length) {
    throw new Error(
      "Le nombre de clusters (k) est supérieur au nombre de lignes"
    );
  }

  // Identifier les colonnes numériques et catégoriques
  const numericColumns = [];
  const categoricalColumns = [];
  columns.forEach((col) => {
    const isNumeric = data.every(
      (row) => !isNaN(parseFloat(row[col])) && isFinite(row[col])
    );
    if (isNumeric) {
      numericColumns.push(col);
    } else {
      categoricalColumns.push(col);
    }
  });

  // Cas spécial : uniquement des colonnes catégoriques
  if (numericColumns.length === 0 && categoricalColumns.length > 0) {
    // Compter les combinaisons uniques de valeurs catégoriques
    const uniqueCombinations = new Set(
      data.map((row) => categoricalColumns.map((col) => row[col]).join("||"))
    );
    if (k > uniqueCombinations.size) {
      throw new Error(
        `Le nombre de clusters (k=${k}) est supérieur au nombre de combinaisons uniques (${uniqueCombinations.size})`
      );
    }

    // Si k correspond au nombre de valeurs uniques, assigner directement
    if (categoricalColumns.length === 1 && uniqueCombinations.size === k) {
      const col = categoricalColumns[0];
      const values = [...uniqueCombinations];
      const clusterMap = {};
      values.forEach((val, i) => {
        clusterMap[val] = i;
      });
      return {
        data: data.map((row) => ({
          ...row,
          cluster: clusterMap[row[col]],
        })),
        k,
      };
    }

    // Appliquer One-Hot Encoding
    const categoricalValues = {};
    categoricalColumns.forEach((col) => {
      categoricalValues[col] = [...new Set(data.map((row) => row[col]))].filter(
        (v) => v != null
      );
    });

    const encodedColumns = [];
    const encodedData = data.map((row) => {
      const encodedRow = { ...row };
      categoricalColumns.forEach((col) => {
        categoricalValues[col].forEach((value) => {
          const encodedCol = `${col}_${value}`;
          encodedRow[encodedCol] = row[col] === value ? 1 : 0;
          if (!encodedColumns.includes(encodedCol)) {
            encodedColumns.push(encodedCol);
          }
        });
      });
      return encodedRow;
    });

    // Préparer les données pour le clustering
    const X = encodedData.map((row) =>
      encodedColumns.map((c) => parseFloat(row[c]) || 0)
    );
    const xs = tf.tensor2d(X);

    // Initialisation k-means++ robuste
    let centroids = [];
    const selectedIndices = new Set();
    // Premier centroïde
    let randomIndex = Math.floor(Math.random() * X.length);
    centroids.push(X[randomIndex]);
    selectedIndices.add(randomIndex);

    // Choisir k-1 autres centroïdes
    for (let i = 1; i < k; i++) {
      // Calculer les distances minimales aux centroïdes existants
      const centroidsTensor = tf.tensor2d(centroids);
      const distances = xs
        .sub(centroidsTensor)
        .square()
        .sum(1)
        .dataSync()
        .map((d, idx) => (selectedIndices.has(idx) ? 0 : d));
      centroidsTensor.dispose();

      const total = distances.reduce((sum, d) => sum + d, 0);
      if (total === 0) {
        // Choisir un indice non sélectionné
        const remainingIndices = Array.from({ length: X.length })
          .map((_, idx) => idx)
          .filter((idx) => !selectedIndices.has(idx));
        if (remainingIndices.length === 0) {
          throw new Error(
            "Impossible d'initialiser suffisamment de centroïdes distincts"
          );
        }
        randomIndex =
          remainingIndices[Math.floor(Math.random() * remainingIndices.length)];
      } else {
        // Sélection basée sur les probabilités
        const probabilities = distances.map((d) => d / total);
        let cumulative = 0;
        const rand = Math.random();
        randomIndex = 0;
        for (let j = 0; j < probabilities.length; j++) {
          cumulative += probabilities[j];
          if (rand <= cumulative) {
            randomIndex = j;
            break;
          }
        }
        // Éviter les doublons
        if (selectedIndices.has(randomIndex)) {
          const remainingIndices = Array.from({ length: X.length })
            .map((_, idx) => idx)
            .filter((idx) => !selectedIndices.has(idx));
          randomIndex =
            remainingIndices[
              Math.floor(Math.random() * remainingIndices.length)
            ] || randomIndex;
        }
      }
      centroids.push(X[randomIndex]);
      selectedIndices.add(randomIndex);
    }

    let centroidsTensor = tf.tensor2d(centroids);
    if (centroidsTensor.shape[0] !== k) {
      centroidsTensor.dispose();
      throw new Error(
        `Erreur d'initialisation : seulement ${centroidsTensor.shape[0]} centroïdes créés au lieu de ${k}`
      );
    }

    // Boucle k-means
    const assignments = new Array(X.length).fill(0);
    for (let iter = 0; iter < 10; iter++) {
      const distances = tf.sum(
        tf.square(tf.sub(xs.expandDims(1), centroidsTensor)),
        2
      );
      const newAssignments = tf.argMin(distances, 1).dataSync();

      const changed = newAssignments.some((a, i) => a !== assignments[i]);
      assignments.splice(0, assignments.length, ...newAssignments);
      if (!changed) break;

      const newCentroids = [];
      const usedClusters = new Set();
      for (let j = 0; j < k; j++) {
        const clusterIndices = assignments
          .map((a, idx) => (a === j ? idx : -1))
          .filter((idx) => idx !== -1);
        if (clusterIndices.length > 0) {
          const clusterPoints = xs.gather(clusterIndices);
          const mean = clusterPoints.mean(0).dataSync();
          newCentroids.push(mean);
          usedClusters.add(j);
          clusterPoints.dispose();
        } else {
          // Choisir un point aléatoire non assigné à un autre cluster
          const availableIndices = Array.from({ length: X.length })
            .map((_, idx) => idx)
            .filter((idx) => !assignments.includes(idx));
          const randomIdx =
            availableIndices.length > 0
              ? availableIndices[
                  Math.floor(Math.random() * availableIndices.length)
                ]
              : Math.floor(Math.random() * X.length);
          newCentroids.push(X[randomIdx]);
        }
      }

      centroidsTensor.dispose();
      centroidsTensor = tf.tensor2d(newCentroids);
      if (centroidsTensor.shape[0] !== k) {
        centroidsTensor.dispose();
        throw new Error(
          `Erreur dans k-means : seulement ${centroidsTensor.shape[0]} centroïdes après itération`
        );
      }
      distances.dispose();
    }

    // Ajouter les clusters aux données originales
    const result = data.map((row, i) => ({
      ...row,
      cluster: assignments[i],
    }));

    // Nettoyer les tensors
    centroidsTensor.dispose();
    xs.dispose();

    return { data: result, k };
  }

  // Cas général (numériques + catégoriques)
  const categoricalValues = {};
  categoricalColumns.forEach((col) => {
    categoricalValues[col] = [...new Set(data.map((row) => row[col]))].filter(
      (v) => v != null
    );
  });

  const encodedColumns = [];
  const encodedData = data.map((row) => {
    const encodedRow = { ...row };
    categoricalColumns.forEach((col) => {
      categoricalValues[col].forEach((value) => {
        const encodedCol = `${col}_${value}`;
        encodedRow[encodedCol] = row[col] === value ? 1 : 0;
        if (!encodedColumns.includes(encodedCol)) {
          encodedColumns.push(encodedCol);
        }
      });
    });
    return encodedRow;
  });

  const clusteringColumns = [...numericColumns, ...encodedColumns];
  const X = encodedData.map((row) =>
    clusteringColumns.map((c, idx) =>
      numericColumns.includes(clusteringColumns[idx])
        ? parseFloat(row[c]) || 0
        : row[c]
    )
  );
  const xs = tf.tensor2d(X);

  // Normaliser uniquement les colonnes numériques
  const xMean = xs.mean(0);
  const xStd = tf.sqrt(xs.sub(xMean).square().mean(0));
  const mask = tf.tensor1d(
    clusteringColumns.map((c) => (numericColumns.includes(c) ? 1 : 0))
  );
  const xsNormalized = xs
    .sub(xMean.mul(mask))
    .div(tf.where(mask.equal(1), xStd, tf.onesLike(xStd)));

  // Initialisation k-means++ robuste
  let centroids = [];
  const selectedIndices = new Set();
  let randomIndex = Math.floor(Math.random() * X.length);
  centroids.push(X[randomIndex]);
  selectedIndices.add(randomIndex);

  for (let i = 1; i < k; i++) {
    const centroidsTensor = tf.tensor2d(centroids);
    const distances = xs
      .sub(centroidsTensor)
      .square()
      .sum(1)
      .dataSync()
      .map((d, idx) => (selectedIndices.has(idx) ? 0 : d));
    centroidsTensor.dispose();

    const total = distances.reduce((sum, d) => sum + d, 0);
    if (total === 0) {
      const remainingIndices = Array.from({ length: X.length })
        .map((_, idx) => idx)
        .filter((idx) => !selectedIndices.has(idx));
      if (remainingIndices.length === 0) {
        throw new Error(
          "Impossible d'initialiser suffisamment de centroïdes distincts"
        );
      }
      randomIndex =
        remainingIndices[Math.floor(Math.random() * remainingIndices.length)];
    } else {
      const probabilities = distances.map((d) => d / total);
      let cumulative = 0;
      const rand = Math.random();
      randomIndex = 0;
      for (let j = 0; j < probabilities.length; j++) {
        cumulative += probabilities[j];
        if (rand <= cumulative) {
          randomIndex = j;
          break;
        }
      }
      if (selectedIndices.has(randomIndex)) {
        const remainingIndices = Array.from({ length: X.length })
          .map((_, idx) => idx)
          .filter((idx) => !selectedIndices.has(idx));
        randomIndex =
          remainingIndices[
            Math.floor(Math.random() * remainingIndices.length)
          ] || randomIndex;
      }
    }
    centroids.push(X[randomIndex]);
    selectedIndices.add(randomIndex);
  }

  let centroidsTensor = tf.tensor2d(centroids);
  if (centroidsTensor.shape[0] !== k) {
    centroidsTensor.dispose();
    throw new Error(
      `Erreur d'initialisation : seulement ${centroidsTensor.shape[0]} centroïdes créés au lieu de ${k}`
    );
  }

  // Boucle k-means
  const assignments = new Array(X.length).fill(0);
  for (let iter = 0; iter < 10; iter++) {
    const distances = tf.sum(
      tf.square(tf.sub(xsNormalized.expandDims(1), centroidsTensor)),
      2
    );
    const newAssignments = tf.argMin(distances, 1).dataSync();

    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments.splice(0, assignments.length, ...newAssignments);
    if (!changed) break;

    const newCentroids = [];
    const usedClusters = new Set();
    for (let j = 0; j < k; j++) {
      const clusterIndices = assignments
        .map((a, idx) => (a === j ? idx : -1))
        .filter((idx) => idx !== -1);
      if (clusterIndices.length > 0) {
        const clusterPoints = xsNormalized.gather(clusterIndices);
        const mean = clusterPoints.mean(0).dataSync();
        newCentroids.push(mean);
        usedClusters.add(j);
        clusterPoints.dispose();
      } else {
        const randomIdx = Math.floor(Math.random() * X.length);
        newCentroids.push(X[randomIdx]);
      }
    }

    centroidsTensor.dispose();
    centroidsTensor = tf.tensor2d(newCentroids);
    if (centroidsTensor.shape[0] !== k) {
      centroidsTensor.dispose();
      throw new Error(
        `Erreur dans k-means : seulement ${centroidsTensor.shape[0]} centroïdes après itération`
      );
    }
    distances.dispose();
  }

  // Ajouter les clusters aux données originales
  const result = data.map((row, i) => ({
    ...row,
    cluster: assignments[i],
  }));

  // Nettoyer les tensors
  tf.dispose([xs, xsNormalized, centroidsTensor, mask]);

  return { data: result, k };
};

// const performClustering = async (data, columns, k) => {
//   // Préparer les données
//   const X = data.map((row) => columns.map((c) => parseFloat(row[c]) || 0));
//   const xs = tf.tensor2d(X);

//   // Implémentation simple de k-means avec TensorFlow.js
//   const centroids = tf.tensor2d(X.slice(0, k));
//   let assignments;
//   for (let i = 0; i < 10; i++) {
//     // Calculer les distances aux centroïdes
//     const distances = tf.sum(tf.square(tf.sub(xs.expandDims(1), centroids)), 2);
//     assignments = tf.argMin(distances, 1).dataSync();
//     // Mettre à jour les centroïdes
//     const newCentroids = [];
//     for (let j = 0; j < k; j++) {
//       const clusterPoints = X.filter((_, idx) => assignments[idx] === j);
//       if (clusterPoints.length > 0) {
//         const mean = tf.mean(tf.tensor2d(clusterPoints), 0).dataSync();
//         newCentroids.push(mean);
//       } else {
//         newCentroids.push(centroids.slice([j, 0], [1, -1]).dataSync());
//       }
//     }
//     centroids.dispose();
//     centroids = tf.tensor2d(newCentroids);
//   }

//   // Ajouter les clusters aux données
//   const result = data.map((row, i) => ({
//     ...row,
//     cluster: assignments[i],
//   }));

//   tf.dispose([xs, centroids]);
//   return { data: result, k };
// };

// Enregistrer un résultat (graphique, rapport, shapefile, etc.)

// Map des formats aux motifs de MIME types

// Enregistrer un résultat (graphique, rapport, shapefile, etc.)
const saveResult = async (userId, sourceId, resultType, config, files) => {
  const validResultTypes = ["image", "report", "json", "geojson", "shapefile"];
  if (!validResultTypes.includes(resultType)) {
    throw new Error(
      "Type de résultat invalide. Valeurs acceptées : image, report, json, geojson, shapefile"
    );
  }

  // Vérifier la source et le dataset
  const source = await DataSources.findOne({
    where: { source_id: sourceId, user_id: userId },
  });
  if (!source) {
    throw new Error("Source de données non trouvée ou non autorisée");
  }

  const dataset = await Datasets.findOne({
    where: { source_id: sourceId },
  });
  if (!dataset) {
    throw new Error("Aucun jeu de données associé à cette source");
  }

  if (!files || files.length === 0) {
    throw new Error(
      "Au moins un fichier est requis pour enregistrer le résultat"
    );
  }

  const mimeTypes = [
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "application/geo+json",
    "application/json",
    "application/pdf",
    "application/zip",
    "application/octet-stream",
    "application/vnd.shp",
    "application/vnd.dbf",
    "application/vnd.shp.shx",
  ];

  for (const file of files) {
    console.log(file.mimetype);
    if (!mimeTypes.includes(file.mimetype)) {
      throw new Error(
        `Type de fichier invalide : ${
          file.originalname
        }. Types acceptés : ${mimeTypes.join(", ")}`
      );
    }
    // if (file.size > MAX_FILE_SIZE) {
    //   throw new Error(
    //     `Taille de fichier trop grande : ${
    //       file.originalname
    //     }. Taille maximale : ${MAX_FILE_SIZE / 1024} Ko`
    //   );
    // }
    if (file.size === 0) {
      throw new Error(
        `Fichier vide : ${file.originalname}. Veuillez fournir un fichier valide.`
      );
    }
    if (
      resultType === "shapefile" &&
      file.mimetype !== "application/zip" &&
      file.mimetype !== "application/octet-stream" &&
      !file.mimetype.startsWith("application/vnd.")
    ) {
      throw new Error(
        `Type de fichier invalide pour un shapefile : ${file.originalname}. Un shapefile doit être un fichier ZIP ou un fichier binaire.`
      );
    }
    if (resultType === "image" && !file.mimetype.startsWith("image/")) {
      throw new Error(
        `Type de fichier invalide pour une image : ${file.originalname}. Un fichier image doit être de type image/png, image/jpeg ou image/svg+xml.`
      );
    }
    if (resultType === "report" && file.mimetype !== "application/pdf") {
      throw new Error(
        `Type de fichier invalide pour un rapport : ${file.originalname}. Un rapport doit être un fichier PDF.`
      );
    }
    if (
      resultType === "geojson" &&
      file.mimetype !== "application/json" &&
      file.mimetype !== "application/geo+json"
    ) {
      throw new Error(
        `Type de fichier invalide pour un GeoJSON : ${file.originalname}. Un GeoJSON doit être un fichier JSON ou GeoJSON.`
      );
    }
    if (resultType === "json" && file.mimetype !== "application/json") {
      throw new Error(
        `Type de fichier invalide pour un JSON : ${file.originalname}. Un JSON doit être un fichier JSON.`
      );
    }
    // if (dataset.data_format === "shapefile" && resultType !== "shapefile") {
    //   throw new Error(
    //     `Le format des données initiales est shapefile. Le résultat doit être de type shapefile.`
    //   );
    // }
    if (dataset.data_format !== "shapefile" && resultType === "shapefile") {
      throw new Error(
        `Le format des données initiales n'est pas shapefile. Le résultat ne peut pas être de type shapefile.`
      );
    }
    if (dataset.data_format !== "shapefile" && resultType === "geojson") {
      throw new Error(
        `Le format des données initiales n'est pas shapefile. Le résultat ne peut pas être de type geojson.`
      );
    }
  }

  let format, filePath, fileBuffer;

  // Cas 1 : Shapefile avec fichiers individuels (.shp, .shx, .dbf)
  if (resultType === "shapefile" && files.length > 1) {
    format = "shapefile";
    const fileNames = files.map((file) => file.originalname.toLowerCase());
    const hasShp = fileNames.some((name) => name.endsWith(".shp"));
    const hasShx = fileNames.some((name) => name.endsWith(".shx"));
    const hasDbf = fileNames.some((name) => name.endsWith(".dbf"));
    if (!hasShp || !hasShx || !hasDbf) {
      throw new Error("Un shapefile doit inclure .shp, .shx et .dbf");
    }

    // Créer un ZIP avec les fichiers
    const zip = new AdmZip();
    files.forEach((file) => {
      zip.addFile(file.originalname, file.buffer);
    });
    fileBuffer = zip.toBuffer();
    filePath = `dataworkspace/results/${userId}/${Date.now()}_${
      dataset.metadata.original_filename
    }_result_${resultType}.zip`;
  }
  // Cas 2 : Fichier unique (ZIP pour shapefile ou autre format)
  else if (files.length === 1) {
    const file = files[0];
    format =
      resultType === "shapefile"
        ? "shapefile"
        : file.mimetype.split("/")[1].split("+")[0]; // Ex. : svg pour image/svg+xml
    format = format === "geo" ? "geojson" : format; // Corriger pour geojson
    if (resultType === "shapefile" && file.mimetype.includes("zip")) {
      // Vérifier le contenu du ZIP
      const zip = new AdmZip(file.buffer);
      const entries = zip.getEntries();
      const hasShp = entries.some((entry) => entry.entryName.endsWith(".shp"));
      const hasShx = entries.some((entry) => entry.entryName.endsWith(".shx"));
      const hasDbf = entries.some((entry) => entry.entryName.endsWith(".dbf"));
      if (!hasShp || !hasShx || !hasDbf) {
        throw new Error(
          "Le fichier ZIP doit contenir .shp, .shx et .dbf pour un shapefile"
        );
      }
      fileBuffer = file.buffer;
      filePath = `dataworkspace/results/${userId}/${Date.now()}_${
        dataset.metadata.original_filename
      }_result_${resultType}.zip`;
    } else {
      // Valider le MIME type pour les autres formats
      // if (!validateMimeType(file.mimetype, format)) {
      //   throw new Error(
      //     `MIME type invalide pour ${format}. Reçu : ${file.mimetype}`
      //   );
      // }
      fileBuffer = file.buffer;
      const fileExtension = format === "shapefile" ? "shp" : format;
      filePath = `dataworkspace/results/${userId}/${Date.now()}_${
        dataset.metadata.original_filename.split(".")[0]
      }_result_${resultType}.${fileExtension}`;
    }
  } else {
    throw new Error("Trop de fichiers pour un résultat non-shapefile");
  }

  // Stocker dans MinIO
  await minioClient.putObject(BUCKET_NAME, filePath, fileBuffer);

  // Enregistrer dans Results
  const result = await Results.create({
    user_id: userId,
    dataset_id: dataset.dataset_id,
    result_type: resultType,
    file_path: filePath,
    format,
    metadata: config || {},
  });

  // Enregistrer l'étape
  // await ProcessingSteps.create({
  //   dataset_id: dataset.dataset_id,
  //   step_type: `result_${resultType}`,
  //   step_description: `Enregistrement de ${resultType} (format: ${format})`,
  //   parameters: config || {},
  //   result_dataset_id: result.result_id,
  // });

  return {
    success: true,
    result_id: result.result_id,
    file_path: filePath,
    message: "Résultat enregistré avec succès",
  };
};

// Télécharger un fichier de résultat
const downloadResult = async (userId, resultId) => {
  // Vérifier le résultat
  const result = await Results.findOne({
    where: { result_id: resultId, user_id: userId },
    // include: [
    //   {
    //     model: Datasets,
    //     include: [{ model: DataSources, where: { user_id: userId } }],
    //   },
    // ],
  });
  if (!result) {
    throw new Error("Résultat non trouvé ou non autorisé");
  }

  // Générer une URL signée
  const downloadUrl = await minioClient.presignedGetObject(
    BUCKET_NAME,
    result.file_path,
    60 * 60
  ); // Valide 1h

  return {
    success: true,
    download_url: downloadUrl,
    message: "URL de téléchargement générée",
  };
};

// Soumettre un dataset et/ou un résultat pour validation
const submitResult = async (userId, datasetId, resultId, comments) => {
  if (datasetId && resultId) {
    throw new Error(
      "Vous ne pouvez pas fournir à la fois dataset_id et result_id"
    );
  }
  // Vérifier dataset_id
  let dataset;
  if (datasetId) {
    dataset = await Datasets.findOne({
      include: [{ model: DataSources, where: { user_id: userId } }],
      where: { dataset_id: datasetId },
    });
    if (!dataset) {
      throw new Error("Dataset non trouvé ou non autorisé");
    }
  }

  // Vérifier result_id
  let result;
  if (resultId) {
    result = await Results.findOne({
      where: { result_id: resultId },
      include: [
        {
          model: Datasets,
          include: [{ model: DataSources, where: { user_id: userId } }],
        },
      ],
    });
    if (!result) {
      throw new Error("Résultat non trouvé ou non autorisé");
    }
  }

  if (!datasetId && !resultId) {
    throw new Error("Au moins un dataset_id ou result_id est requis");
  }

  // Créer la soumission
  const submission = await Submissions.create({
    user_id: userId,
    dataset_id: datasetId || null,
    result_id: resultId || null,
    submission_status: "pending",
    submission_comments: comments || null,
  });

  // Enregistrer l'étape
  // const targetDatasetId = datasetId || result.dataset_id;
  // await ProcessingSteps.create({
  //   dataset_id: targetDatasetId,
  //   step_type: "submission",
  //   step_description: `Soumission pour validation (dataset_id: ${
  //     datasetId || "aucun"
  //   }, result_id: ${resultId || "aucun"})`,
  //   parameters: { dataset_id: datasetId, result_id: resultId, comments },
  //   result_dataset_id: null,
  // });

  return {
    success: true,
    submission_id: submission.submission_id,
    status: submission.submission_status,
    message: "Soumission enregistrée avec succès",
  };
};

// Récupérer le statut d'une soumission
const getSubmissionStatus = async (userId, submissionId) => {
  const submission = await Submissions.findOne({
    where: { submission_id: submissionId, user_id: userId },
  });
  if (!submission) {
    throw new Error("Soumission non trouvée ou non autorisée");
  }

  return {
    success: true,
    submission_id: submission.submission_id,
    status: submission.submission_status,
  };
};

// Mettre à jour une soumission
const updateSubmission = async (
  userId,
  submissionId,
  datasetId,
  resultId,
  comments
) => {
  const submission = await Submissions.findOne({
    where: { submission_id: submissionId, user_id: userId },
  });
  if (!submission) {
    throw new Error("Soumission non trouvée ou non autorisée");
  }

  // Vérifier que la soumission est modifiable
  if (
    !["pending", "revision_requested"].includes(submission.submission_status)
  ) {
    throw new Error(
      "Seules les soumissions en attente ou en révision peuvent être mises à jour"
    );
  }

  // Vérifier qu'au moins un champ est fourni
  if (!datasetId && !resultId && !comments) {
    throw new Error(
      "Au moins un champ à mettre à jour est requis (dataset_id, result_id, comments)"
    );
  }

  if (datasetId && resultId) {
    throw new Error(
      "Vous ne pouvez pas fournir à la fois dataset_id et result_id"
    );
  }

  // Vérifier dataset_id
  if (datasetId) {
    const dataset = await Datasets.findOne({
      include: [{ model: DataSources, where: { user_id: userId } }],
      where: { dataset_id: datasetId },
    });
    if (!dataset) {
      throw new Error("Dataset non trouvé ou non autorisé");
    }
    resultId = null; // Ne pas permettre de changer le dataset_id et result_id en même temps
  } else if (resultId) {
    // Vérifier result_id
    const result = await Results.findOne({
      where: { result_id: resultId, user_id: userId }, // Utilisation de user_id dans Results
    });
    if (!result) {
      throw new Error("Résultat non trouvé ou non autorisé");
    }
    datasetId = null; // Ne pas permettre de changer le dataset_id et result_id en même temps
  }

  // Mettre à jour la soumission
  await submission.update({
    dataset_id: datasetId,
    result_id: resultId,
    submission_status: "pending",
    submission_comments: comments || submission.submission_comments,
  });

  // Enregistrer l'étape
  // await ProcessingSteps.create({
  //   dataset_id: datasetId || submission.dataset_id,
  //   step_type: "submission_update",
  //   step_description: `Mise à jour de la soumission ${submissionId}`,
  //   parameters: { dataset_id: datasetId, result_id: resultId, metadata },
  //   result_dataset_id: null,
  // });

  return {
    success: true,
    submission_id: submission.submission_id,
    status: "updated",
  };
};

// Annuler une soumission
const cancelSubmission = async (userId, submissionId) => {
  const submission = await Submissions.findOne({
    where: { submission_id: submissionId, user_id: userId },
  });
  if (!submission) {
    throw new Error("Soumission non trouvée ou non autorisée");
  }

  if (
    !["pending", "revision_requested"].includes(submission.submission_status)
  ) {
    throw new Error(
      "Seules les soumissions en attente ou en révision peuvent être annulées"
    );
  }

  await submission.destroy();

  // Enregistrer l'étape
  // await ProcessingSteps.create({
  //   dataset_id: submission.dataset_id,
  //   step_type: "submission_cancel",
  //   step_description: `Annulation de la soumission ${submissionId}`,
  //   parameters: { submission_id: submissionId },
  //   result_dataset_id: null,
  // });

  return {
    success: true,
    submission_id: submissionId,
    status: "cancelled",
  };
};

// Mettre à jour le statut d'une soumission
const updateSubmissionStatus = async (user, submissionId, status) => {
  const validStatuses = [
    "pending",
    "approved",
    "rejected",
    "revision_requested",
  ];
  if (!validStatuses.includes(status)) {
    throw new Error(
      "Statut invalide. Valeurs acceptées : pending, approved, rejected, revision_requested"
    );
  }

  const submission = await Submissions.findOne({
    where: { submission_id: submissionId },
  });
  if (!submission) {
    throw new Error("Soumission non trouvée");
  }

  // Vérifier si l'utilisateur est un validateur (exemple simplifié)

  const userRole = user.role; // Récupérer le rôle de l'utilisateur
  const isValidator = userRole === "validator"; // Vérifier si l'utilisateur est un validateur

  if (!isValidator) {
    throw new Error("Seuls les validateurs peuvent mettre à jour le statut");
  }

  await submission.update({
    submission_status: status,
  });

  // Enregistrer l'étape
  // await ProcessingSteps.create({
  //   dataset_id: submission.dataset_id,
  //   step_type: "submission_status_update",
  //   step_description: `Mise à jour du statut de la soumission ${submissionId} à ${status}`,
  //   parameters: { submission_id: submissionId, status },
  //   result_dataset_id: null,
  // });

  return {
    success: true,
    submission_id: submission.submission_id,
    status,
  };
};

module.exports = {
  listDataSources,
  addDataSource,
  deleteDataSource,
  loadDataFromSource,
  applyDataTransformation,
  performDataAnalysis,
  saveResult,
  downloadResult,
  submitResult,
  getSubmissionStatus,
  updateSubmission,
  cancelSubmission,
  updateSubmissionStatus,
};
