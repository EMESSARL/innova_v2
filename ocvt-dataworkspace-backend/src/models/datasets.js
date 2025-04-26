const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const DataSources = require("./dataSources");

const Datasets = sequelize.define(
  "Datasets",
  {
    dataset_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    source_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: DataSources,
        key: "source_id",
      },
    },
    user_id: {
      type: DataTypes.STRING, // Référence à l'utilisateur (fournie par Authentication Microfrontend)
      allowNull: false,
    },
    dataset_name: {
      type: DataTypes.STRING, // Nom du jeu de données (texte)
      allowNull: false,
    },
    data_format: {
      type: DataTypes.ENUM("csv", "excel", "json", "xml", "shapefile"), // Format des données
      allowNull: false,
    },
    data_content: {
      type: DataTypes.STRING, // Chemin vers le fichier dans MinIO (texte)
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON, // Métadonnées (JSON)
      allowNull: true,
    },
    // created_at: {
    //   type: DataTypes.DATE,
    //   allowNull: false,
    //   defaultValue: Sequelize.NOW,
    // },
    // updated_at: {
    //   type: DataTypes.DATE,
    //   allowNull: false,
    //   defaultValue: Sequelize.NOW,
    // },
  },
  {
    tableName: "Datasets",
    // timestamps: false,
  }
);

// Relations
DataSources.hasMany(Datasets, { foreignKey: "source_id" });
Datasets.belongsTo(DataSources, { foreignKey: "source_id" });

module.exports = Datasets;
