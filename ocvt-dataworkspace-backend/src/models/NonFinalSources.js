const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const NonFinalSources = sequelize.define(
  "NonFinalSources",
  {
    non_final_source_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    source_type: {
      type: DataTypes.ENUM("file", "database", "api"),
      allowNull: false,
    },
    source_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    tableName: "NonFinalSources",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = NonFinalSources;