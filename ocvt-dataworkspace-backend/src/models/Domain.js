const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Domain = sequelize.define(
  "Domain",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
        len: [1, 255],
      },
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "Domain",
    timestamps: false,
    paranoid: true,
    underscored: true,
  }
);

module.exports = Domain;
