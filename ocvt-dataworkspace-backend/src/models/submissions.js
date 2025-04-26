const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Datasets = require("./datasets");
const Results = require("./results");

const Submissions = sequelize.define(
  "Submissions",
  {
    submission_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    dataset_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: Datasets,
        key: "dataset_id",
      },
    },
    result_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: Results,
        key: "result_id",
      },
    },
    submission_status: {
      type: DataTypes.ENUM(
        "pending",
        "approved",
        "rejected",
        "revision_requested"
      ),
      allowNull: false,
      defaultValue: "pending",
    },
    submission_comments: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "Submissions",
  }
);

// Relations
Datasets.hasMany(Submissions, { foreignKey: "dataset_id" });
Submissions.belongsTo(Datasets, { foreignKey: "dataset_id" });

Results.hasMany(Submissions, { foreignKey: "result_id" });
Submissions.belongsTo(Results, { foreignKey: "result_id" });

module.exports = Submissions;
