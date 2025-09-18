const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const SubDomain = sequelize.define(
  "SubDomain",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 255],
      },
    },
    domain_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Domain",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "SubDomain",
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["name", "domain_id"],
        name: "unique_subdomain_per_domain",
      },
    ],
  }
);

module.exports = SubDomain;
