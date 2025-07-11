const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const FinalResults = sequelize.define(
  "FinalResults",
  {
    final_result_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    result_type: {
      type: DataTypes.ENUM("file", "database", "api"),
      allowNull: false,
    },
    result_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    tableName: "FinalResults",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = FinalResults;