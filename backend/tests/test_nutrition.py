"""Protein and water stay blank when unentered. A missing nutrient is not zero."""
import nutrition


def test_unentered_protein_and_water_stay_blank():
    stored = nutrition.session_nutrition(None, "   ")
    assert stored == {}
    public = nutrition.public_log(stored)
    assert public == {"protein_g": None, "water_ml": None}
    assert 0 not in public.values()
    assert nutrition.session_nutrition("", None) == {}
    assert nutrition.parse_amount("abc") is None


def test_entered_amounts_are_kept_and_a_typed_zero_is_not_invented_for_the_other():
    stored = nutrition.session_nutrition("32,5", None)
    assert stored == {"protein_g": 32.5}
    assert "water_ml" not in stored
    assert nutrition.public_log(stored)["water_ml"] is None
    assert nutrition.session_nutrition(0, "400") == {"protein_g": 0.0, "water_ml": 400.0}


def test_missing_nutrient_is_omitted_not_filled_with_zero():
    view = nutrition.product_view({
        "status": 1,
        "product": {
            "product_name": "Yaourt",
            "nutrition_data_per": "100g",
            "nutriments": {"proteins_100g": 5.2, "sugars_100g": None, "sodium_serving": 0.4},
        },
    })
    keys = [row["key"] for row in view["nutrients"]]
    assert keys == ["proteins"]
    assert view["nutrients"][0]["value"] == 5.2
    assert view["nutrients"][0]["opinion"] is None
    assert all(row["value"] != 0 or row["key"] == "proteins" for row in view["nutrients"])
    assert "sugars" not in keys
    assert "sodium" not in keys
    assert "fibre" not in keys


def test_sodium_on_the_label_carries_one_opinion_and_salt_does_not_repeat_it():
    view = nutrition.product_view({
        "status": 1,
        "product": {
            "product_name": "Bouillon",
            "nutrition_data_per": "100g",
            "nutriments": {"sodium_100g": 0.8, "salt_100g": 2.0, "sugars_100g": 1.0, "fiber_100g": 3},
        },
    })
    by_key = {row["key"]: row for row in view["nutrients"]}
    assert by_key["sodium"]["opinion"] == "sodium"
    assert by_key["salt"]["opinion"] is None
    assert by_key["sugars"]["opinion"] == "sugars"
    assert by_key["fibre"]["opinion"] == "fibre"
    assert sum(1 for row in view["nutrients"] if row["opinion"] == "sodium") == 1


def test_salt_alone_still_uses_the_sodium_opinion():
    view = nutrition.product_view({
        "status": 1,
        "product": {"nutriments": {"salt_100g": 1.2}, "nutrition_data_per": "100g"},
    })
    assert view["nutrients"] == [{"key": "salt", "value": 1.2, "unit": "g", "opinion": "sodium"}]


def test_no_nutrition_data_does_not_invent_numbers():
    view = nutrition.product_view({
        "status": 1,
        "product": {
            "product_name": "Eau",
            "no_nutrition_data": "on",
            "nutriments": {"sugars_100g": 9, "sodium_100g": 0.1, "proteins_100g": 0},
        },
    })
    assert view["ok"] is True
    assert view["notice"] == "no_facts"
    assert view["nutrients"] == []
    assert view["name"] == "Eau"


def test_a_failed_lookup_has_no_nutrients():
    assert nutrition.product_view({"status": 0, "product": None})["nutrients"] == []
    assert nutrition.product_view({"status": 0})["notice"] == "lookup_failed"
    assert nutrition.normalize_barcode("nutella") is None
    assert nutrition.product_url("3017624010701").startswith(
        "https://world.openfoodfacts.org/api/v2/product/3017624010701.json"
    )


def test_opinions_are_only_the_three_who_lines():
    assert nutrition.opinion_for("sodium") == "sodium"
    assert nutrition.opinion_for("salt") == "sodium"
    assert nutrition.opinion_for("sugars") == "sugars"
    assert nutrition.opinion_for("fibre") == "fibre"
    for field in ("proteins", "protein_g", "water_ml", "fat", "energy", "iron", "caffeine"):
        assert nutrition.opinion_for(field) is None


def test_declared_basis_does_not_borrow_a_missing_nutrient():
    view = nutrition.product_view({
        "status": 1,
        "product": {
            "nutrition_data_per": "serving",
            "serving_size": "30 g",
            "nutriments": {"proteins_serving": 4, "sodium_100g": 0.5},
        },
    })
    assert view["basis"] == "serving"
    assert view["serving_size"] == "30 g"
    assert [row["key"] for row in view["nutrients"]] == ["proteins"]
