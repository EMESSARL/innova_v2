const {
  DataSources,
  Datasets,
  ProcessingSteps,
  Results,
  Submissions,
  SourceTypes,
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
const crypto = require("crypto");
const {
  streamToBuffer,
  flattenXml,
  handleZippedShapefile,
  validateMimeType,
} = require("./utils");

// Fonction utilitaire pour générer un timestamp formaté
const generateTimestamp = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
};

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
if (ENCRYPTION_KEY.length !== 32) {
  throw new Error(
    "ENCRYPTION_KEY doit être une chaîne hexadécimale de 32 bytes"
  );
}

// Chiffrer un texte
const encrypt = (text) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return {
    iv: iv.toString("hex"),
    encrypted: encrypted,
  };
};

// Déchiffrer un texte
const decrypt = (encryptedData) => {
  const iv = Buffer.from(encryptedData.iv, "hex");
  const encrypted = Buffer.from(encryptedData.encrypted, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

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

// Lister les types de sources de données actifs
const listDataSourceTypes = async () => {
  const sourceTypes = await SourceTypes.findAll({
    where: { status: "active" },
    attributes: ["type_name"],
  });
  return {
    success: true,
    data: sourceTypes.map((type) => type.type_name),
    message: "Types de sources récupérés avec succès",
  };
};

// Activer ou désactiver un type de source
const updateSourceTypeStatus = async (sourceTypeId, status) => {
  const validStatuses = ["active", "inactive"];
  if (!validStatuses.includes(status)) {
    throw new Error("Statut invalide. Valeurs acceptées : active, inactive");
  }

  const sourceType = await SourceTypes.findOne({
    where: { source_type_id: sourceTypeId },
  });
  if (!sourceType) {
    throw new Error("Type de source non trouvé");
  }

  await sourceType.update({ status });

  return {
    success: true,
    source_type_id: sourceType.source_type_id,
    type_name: sourceType.type_name,
    status,
    message: "Statut du type de source mis à jour",
  };
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
    throw new Error("La description de la source est requise");
  }

  let filePath;
  let dataFormat;
  let connectionDetailsToStore = connectionDetails || {};

  // Créer l'entrée dans DataSources
  const newSource = await DataSources.create({
    user_id: userId,
    source_type: sourceType,
    source_name: sourceName,
    connection_details: null, // Sera mis à jour après
  });

  if (sourceType === "file") {
    if (!file) {
      throw new Error('Un fichier est requis pour le type "file"');
    }

    const validExtensions = [
      "csv",
      "xls",
      "xlsx",
      "json",
      "xml",
      "shp",
      "zip",
      "pdf",
    ];
    const fileExtension = file.originalname.split(".").pop().toLowerCase();
    if (!validExtensions.includes(fileExtension)) {
      throw new Error(
        "Format de fichier non pris en charge. Formats acceptés : csv, xls, xlsx, json, xml, shp, zip, pdf"
      );
    }

    if (fileExtension === "pdf") {
      const filePath = `dataworkspace/results/${userId}/result_${generateTimestamp()}.pdf`;
      await minioClient.putObject(BUCKET_NAME, filePath, file.buffer);

      connectionDetailsToStore = { file_path: filePath };
      await newSource.update({ connection_details: connectionDetailsToStore });

      const result = await Results.create({
        user_id: userId,
        // dataset_id: null, // Pas de dataset_id pour une source PDF directe
        result_type: "report",
        file_path: filePath,
        format: "pdf",
        metadata: { source_name: sourceName, original_filename: file.originalname },
      });

      return {
        success: true,
        data: { result_id: result.result_id, file_path: filePath },
        message: "Fichier PDF enregistré comme résultat avec succès",
      };
    } else if (fileExtension === "xls" || fileExtension === "xlsx") {
      dataFormat = "excel";
    } else if (fileExtension === "shp" || fileExtension === "zip") {
      dataFormat = "shapefile";
    } else {
      dataFormat = fileExtension;
    }

    filePath = `dataworkspace/sources/${userId}/source_${generateTimestamp()}.${fileExtension}`;
    await minioClient.putObject(BUCKET_NAME, filePath, file.buffer);
    connectionDetailsToStore = { file_path: filePath };
  } else if (sourceType === "database") {
    if (!connectionDetails) {
      throw new Error(
        'Les détails de connexion sont requis pour le type "database"'
      );
    }

    const { host, dialect, username, password, dbname } = connectionDetails;
    if (!host || !dialect || !username || !password || !dbname) {
      throw new Error(
        "Tous les champs sont requis pour une source de type database : host, dialect, username, password, dbname"
      );
    }

    const validDialects = ["mysql", "postgres", "sqlite", "mariadb", "mongodb"];
    if (!validDialects.includes(dialect)) {
      throw new Error(
        "Dialecte invalide. Valeurs acceptées : mysql, postgres, sqlite, mariadb, mongodb"
      );
    }

    dataFormat = "json";
    connectionDetailsToStore = {
      host,
      dialect,
      username,
      password: encrypt(password),
      dbname,
    };
  } else if (sourceType === "api") {
    if (!connectionDetails) {
      throw new Error(
        'Les détails de connexion sont requis pour le type "api"'
      );
    }

    const { url, credentials } = connectionDetails;
    if (!url) {
      throw new Error("L'URL est requise pour une source de type api");
    }

    // Valider l'URL
    try {
      new URL(url);
    } catch {
      throw new Error("L'URL fournie est invalide");
    }

    // Valider les credentials si fournis
    if (credentials) {
      if (
        !((credentials.username && credentials.password) || credentials.api_key)
      ) {
        throw new Error(
          "Les credentials doivent inclure username/password ou api_key"
        );
      }
    }

    dataFormat = "json";
    connectionDetailsToStore = {
      url,
      credentials: encrypt(JSON.stringify(credentials)) || null,
    };
  }

  // Mettre à jour connection_details
  await newSource.update({ connection_details: connectionDetailsToStore });

  // Créer l'entrée dans Datasets
  await Datasets.create({
    source_id: newSource.source_id,
    user_id: userId,
    dataset_name: sourceName,
    data_format: dataFormat,
    data_content: filePath || null,
    metadata: {
      original_filename: file?.originalname || null,
      source_type: sourceType,
    },
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
    filePath = `dataworkspace/results/${userId}/result_${generateTimestamp()}.zip`;
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
      filePath = `dataworkspace/results/${userId}/result_${generateTimestamp()}.${fileExtension}`;
    }
  } else {
    throw new Error("Trop de fichiers pour un résultat non-shapefile");
  }

  // Stocker dans MinIO
  await minioClient.putObject(BUCKET_NAME, filePath, fileBuffer);

  // Enregistrer dans Results
  const result = await Results.create({
    user_id: userId,
    // dataset_id: dataset.dataset_id,
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
  const isValidator = userRole === "ROLE_VALIDATOR"; // Vérifier si l'utilisateur est un validateur

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
  saveResult,
  downloadResult,
  submitResult,
  getSubmissionStatus,
  updateSubmission,
  cancelSubmission,
  updateSourceTypeStatus,
  listDataSourceTypes,
  updateSubmissionStatus,
};
